#!/usr/bin/env node
/**
 * Migration: move permanent match data from Redis to D1/SQLite.
 *
 * Scans all `gql:GetMatch:*`, `gql:GetMatchScorecards:*`, and
 * `computed:matchglobal:*` keys from Redis. For each permanent key (TTL -1),
 * writes the raw JSON blob to the `match_data_cache` table.
 *
 * With --drain: sets a 24h TTL on migrated Redis keys so they self-expire,
 * freeing Redis storage over the next day.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/migrate-match-cache.ts [options]
 *
 * Options:
 *   --target <sqlite|d1>   Write target (default: sqlite)
 *   --drain                Set 24h Redis TTL on migrated keys
 *   --dry-run              Show what would be migrated without writing
 *   --limit <n>            Max keys to migrate (default: unlimited)
 *
 * D1 target requires:
 *   CLOUDFLARE_ACCOUNT_ID  — your Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN   — API token with D1 write permission
 *   D1 database ID is read from wrangler.toml automatically.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import IORedis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { createSqliteDatabase } from "../lib/db-sqlite";
import { parseMatchCacheKey } from "../lib/match-data-store";
import { CACHE_SCHEMA_VERSION } from "../lib/constants";

// ─── .env.local loader ───────────────────────────────────────────────────────

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─── Database writer abstraction ─────────────────────────────────────────────

interface DbWriter {
  setMatchDataCache(
    cacheKey: string,
    data: string,
    meta: { keyType: string; ct: number; matchId: string; schemaVersion: number },
  ): Promise<void>;
}

function getD1DatabaseId(): string {
  const tomlPath = join(process.cwd(), "wrangler.toml");
  if (!existsSync(tomlPath)) {
    throw new Error("wrangler.toml not found — run from the repo root");
  }
  const content = readFileSync(tomlPath, "utf-8");
  // Match the production d1_databases block (not env.staging)
  const match = content.match(/^\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Could not find [[d1_databases]] database_id in wrangler.toml");
  }
  return match[1];
}

function createD1Writer(): DbWriter {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "D1 target requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars.\n" +
      "Set them in .env.local or export them before running.",
    );
  }
  const dbId = getD1DatabaseId();
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;

  console.log(`D1: account=${accountId.slice(0, 8)}…  db=${dbId.slice(0, 8)}…`);

  return {
    async setMatchDataCache(cacheKey, data, meta) {
      const sql = `INSERT INTO match_data_cache (cache_key, key_type, ct, match_id, data, schema_version, stored_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(cache_key)
                   DO UPDATE SET data = excluded.data,
                                 schema_version = excluded.schema_version,
                                 stored_at = excluded.stored_at`;
      const resp = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sql,
          params: [cacheKey, meta.keyType, meta.ct, meta.matchId, data, meta.schemaVersion],
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`D1 API ${resp.status}: ${body.slice(0, 200)}`);
      }
      const result = await resp.json() as { success: boolean; errors?: Array<{ message: string }> };
      if (!result.success) {
        throw new Error(`D1 query failed: ${result.errors?.[0]?.message ?? "unknown"}`);
      }
    },
  };
}

// ─── Redis client abstraction ────────────────────────────────────────────────

interface MigrationClient {
  scanKeys(pattern: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  ttl(key: string): Promise<number>;
  expire(key: string, ttl: number): Promise<void>;
  quit(): Promise<void>;
}

async function createClient(): Promise<MigrationClient> {
  const prefix = process.env.CACHE_KEY_PREFIX ?? "";
  const pk = (key: string) => `${prefix}${key}`;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    const redis = new UpstashRedis({ url: upstashUrl, token: upstashToken, automaticDeserialization: false });
    await redis.ping();
    const host = new URL(upstashUrl).hostname;
    console.log(`Redis: Upstash (${host})${prefix ? `  prefix="${prefix}"` : ""}`);
    return {
      async scanKeys(pattern) {
        const keys: string[] = [];
        let cursor = 0;
        do {
          // Upstash SCAN scans at most `count` keyspace entries per call and
          // returns cursor 0 even when the full keyspace hasn't been covered.
          // Use a large count to ensure we scan all keys in one pass.
          const [nextCursor, batch] = await redis.scan(cursor, { match: pk(pattern), count: 10_000 });
          cursor = Number(nextCursor);
          for (const k of batch) {
            // Strip prefix
            const bare = typeof k === "string" && prefix && k.startsWith(prefix) ? k.slice(prefix.length) : String(k);
            keys.push(bare);
          }
        } while (cursor !== 0);
        return keys;
      },
      async get(key) { return redis.get<string>(pk(key)); },
      async ttl(key) { return redis.ttl(pk(key)); },
      async expire(key, ttlSec) { await redis.expire(pk(key), ttlSec); },
      async quit() { /* no-op */ },
    };
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new IORedis(redisUrl, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 2 });
  await redis.connect();
  console.log(`Redis: ioredis (${redisUrl})${prefix ? `  prefix="${prefix}"` : ""}`);
  return {
    async scanKeys(pattern) {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, "MATCH", pk(pattern), "COUNT", "200");
        cursor = next;
        for (const k of batch) {
          const bare = prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k;
          keys.push(bare);
        }
      } while (cursor !== "0");
      return keys;
    },
    async get(key) { return redis.get(pk(key)); },
    async ttl(key) { return redis.ttl(pk(key)); },
    async expire(key, ttlSec) { await redis.expire(pk(key), ttlSec); },
    async quit() { await redis.quit(); },
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  target: "sqlite" | "d1";
  drain: boolean;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const target = get("--target") ?? "sqlite";
  if (target !== "sqlite" && target !== "d1") {
    console.error(`Error: --target must be "sqlite" or "d1", got "${target}"`);
    process.exit(1);
  }
  return {
    target,
    drain: has("--drain"),
    dryRun: has("--dry-run"),
    limit: get("--limit") !== null ? parseInt(get("--limit")!, 10) : null,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const DRAIN_TTL = 86_400; // 24h

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env.local"));
  const args = parseArgs();

  console.log("Match cache → D1/SQLite migration");
  console.log("─".repeat(50));
  console.log(`Target : ${args.target}`);
  console.log(`Mode   : ${args.dryRun ? "DRY RUN" : args.drain ? "migrate + drain (24h TTL)" : "migrate only (keep Redis keys)"}`);
  if (args.limit) console.log(`Limit  : ${args.limit} keys`);
  console.log("─".repeat(50));

  const client = await createClient();
  const db: DbWriter | null = args.dryRun
    ? null
    : args.target === "d1"
      ? createD1Writer()
      : createSqliteDatabase();

  // Scan all three key patterns
  console.log("\nScanning Redis keys...");
  const [matchKeys, scorecardsKeys, globalKeys] = await Promise.all([
    client.scanKeys("gql:GetMatch:*"),
    client.scanKeys("gql:GetMatchScorecards:*"),
    client.scanKeys("computed:matchglobal:*"),
  ]);

  // Filter GetMatch keys to exclude GetMatchScorecards keys
  const pureMatchKeys = matchKeys.filter(k => !k.startsWith("gql:GetMatchScorecards:"));

  const allKeys = [...pureMatchKeys, ...scorecardsKeys, ...globalKeys];
  console.log(`Found: ${pureMatchKeys.length} match + ${scorecardsKeys.length} scorecards + ${globalKeys.length} matchglobal = ${allKeys.length} total`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of allKeys) {
    if (args.limit !== null && migrated >= args.limit) break;

    // Only migrate permanent keys (TTL -1)
    const ttl = await client.ttl(key);
    if (ttl !== -1) {
      skipped++;
      continue;
    }

    const parsed = parseMatchCacheKey(key);
    if (!parsed) {
      skipped++;
      continue;
    }

    if (args.dryRun) {
      console.log(`  [dry-run] ${parsed.keyType.padEnd(12)} ct=${parsed.ct} id=${parsed.matchId}  ${key.slice(0, 60)}`);
      migrated++;
      continue;
    }

    try {
      const raw = await client.get(key);
      if (!raw) {
        skipped++;
        continue;
      }

      // Determine schema version from the data
      let schemaVersion = CACHE_SCHEMA_VERSION;
      try {
        const meta = JSON.parse(raw) as { v?: number };
        if (meta.v != null) schemaVersion = meta.v;
      } catch { /* use default */ }

      await db!.setMatchDataCache(key, raw, {
        keyType: parsed.keyType,
        ct: parsed.ct,
        matchId: parsed.matchId,
        schemaVersion,
      });

      if (args.drain) {
        await client.expire(key, DRAIN_TTL);
      }

      migrated++;
      if (migrated % 50 === 0) {
        console.log(`  ... migrated ${migrated} keys`);
      }
    } catch (err) {
      console.error(`  FAIL ${key}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  await client.quit();

  console.log("\n" + "─".repeat(50));
  console.log(`Done: migrated=${migrated}  skipped=${skipped}  failed=${failed}`);
  if (args.drain && migrated > 0) {
    console.log(`Redis keys set to expire in 24h (${DRAIN_TTL}s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
