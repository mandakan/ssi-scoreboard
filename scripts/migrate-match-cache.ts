#!/usr/bin/env node
/**
 * One-time migration: move permanent match data from Redis to D1/SQLite.
 *
 * Scans all `gql:GetMatch:*`, `gql:GetMatchScorecards:*`, and
 * `computed:matchglobal:*` keys from Redis. For each permanent key (TTL -1),
 * writes the raw JSON blob to the `match_data_cache` table in SQLite.
 *
 * With --drain: sets a 24h TTL on migrated Redis keys so they self-expire,
 * freeing Redis storage over the next day.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/migrate-match-cache.ts [options]
 *
 * Options:
 *   --drain      Set 24h Redis TTL on migrated keys (default: leave untouched)
 *   --dry-run    Show what would be migrated without writing
 *   --limit <n>  Max keys to migrate (default: unlimited)
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
          const [nextCursor, batch] = await redis.scan(cursor, { match: pk(pattern), count: 200 });
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
  return {
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
  console.log(`Mode   : ${args.dryRun ? "DRY RUN" : args.drain ? "migrate + drain (24h TTL)" : "migrate only (keep Redis keys)"}`);
  if (args.limit) console.log(`Limit  : ${args.limit} keys`);
  console.log("─".repeat(50));

  const client = await createClient();
  const db = createSqliteDatabase();

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

      await db.setMatchDataCache(key, raw, {
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
