#!/usr/bin/env node
/**
 * Diagnostic: count and validate match cache entries in Redis/Upstash and D1/SQLite.
 *
 * For each key type (GetMatch, GetMatchScorecards, matchglobal), shows:
 *   Redis : total keys, permanent (TTL=-1) vs has-TTL, schema-valid vs outdated
 *   D1    : total entries, schema-valid vs outdated
 *
 * Also reports the number of "lab-eligible" matches — where both GetMatch AND
 * GetMatchScorecards exist at the current CACHE_SCHEMA_VERSION in each layer.
 * This is the count `uv run rating sync` can pull from D1.
 *
 * Uses pipeline for Redis to batch GET+TTL operations efficiently.
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/cache-stats.ts                 # SQLite (default) + auto-detect Redis
 *   pnpm tsx scripts/cache-stats.ts --target d1     # D1 API + auto-detect Redis
 *   pnpm tsx scripts/cache-stats.ts --no-redis      # D1/SQLite only (skip Redis scan)
 *   pnpm tsx scripts/cache-stats.ts --no-db         # Redis only (skip D1/SQLite query)
 *
 * D1 target requires:
 *   CLOUDFLARE_ACCOUNT_ID  — your Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN   — API token with D1 read permission
 *   D1 database ID is read from wrangler.toml automatically.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import IORedis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";
import Database from "better-sqlite3";
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface CliArgs {
  target: "sqlite" | "d1";
  noRedis: boolean;
  noDb: boolean;
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
    target: target as "sqlite" | "d1",
    noRedis: has("--no-redis"),
    noDb: has("--no-db"),
  };
}

// ─── Redis stats client ───────────────────────────────────────────────────────

interface KeyMeta {
  ttl: number;       // -1 = permanent, >=0 = has expiry, -2 = not found
  schema: number | null;  // CACHE_SCHEMA_VERSION from JSON blob, null = unreadable
}

interface RedisStatsClient {
  scanKeys(pattern: string): Promise<string[]>;
  /** Fetch TTL and schema version for a batch of keys via pipeline. */
  getKeyMeta(keys: string[]): Promise<KeyMeta[]>;
  quit(): Promise<void>;
}

const PIPELINE_BATCH = 100; // keys per pipeline batch (GET + TTL = 2 commands each)

async function createRedisClient(): Promise<RedisStatsClient> {
  const prefix = process.env.CACHE_KEY_PREFIX ?? "";
  const pk = (key: string) => `${prefix}${key}`;
  const bare = (k: string): string =>
    prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    const redis = new UpstashRedis({
      url: upstashUrl,
      token: upstashToken,
      automaticDeserialization: false,
    });
    await redis.ping();
    const host = new URL(upstashUrl).hostname;
    console.log(`Redis : Upstash (${host})${prefix ? `  prefix="${prefix}"` : ""}`);

    return {
      async scanKeys(pattern) {
        const keys: string[] = [];
        let cursor = 0;
        do {
          const [nextCursor, batch] = await redis.scan(cursor, {
            match: pk(pattern),
            count: 10_000,
          });
          cursor = Number(nextCursor);
          for (const k of batch) {
            keys.push(bare(typeof k === "string" ? k : String(k)));
          }
        } while (cursor !== 0);
        return keys;
      },

      async getKeyMeta(keys) {
        const results: KeyMeta[] = [];
        // Process in batches to avoid oversized pipelines
        for (let i = 0; i < keys.length; i += PIPELINE_BATCH) {
          const chunk = keys.slice(i, i + PIPELINE_BATCH);
          const pipe = redis.pipeline();
          for (const k of chunk) {
            pipe.get(pk(k));
            pipe.ttl(pk(k));
          }
          const pipeResults = await pipe.exec();
          // pipeResults alternates: [get(k0), ttl(k0), get(k1), ttl(k1), ...]
          for (let j = 0; j < chunk.length; j++) {
            const raw = pipeResults[j * 2] as string | null;
            const ttl = pipeResults[j * 2 + 1] as number;
            let schema: number | null = null;
            if (raw) {
              try {
                const parsed = JSON.parse(raw) as { v?: number };
                schema = parsed.v ?? null;
              } catch { /* unreadable */ }
            }
            results.push({ ttl: ttl ?? -2, schema });
          }
        }
        return results;
      },

      async quit() { /* no-op for Upstash */ },
    };
  }

  // ioredis fallback
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
  });
  await redis.connect();
  console.log(`Redis : ioredis (${redisUrl})${prefix ? `  prefix="${prefix}"` : ""}`);

  return {
    async scanKeys(pattern) {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, "MATCH", pk(pattern), "COUNT", "200");
        cursor = next;
        for (const k of batch) keys.push(bare(k));
      } while (cursor !== "0");
      return keys;
    },

    async getKeyMeta(keys) {
      const results: KeyMeta[] = [];
      for (let i = 0; i < keys.length; i += PIPELINE_BATCH) {
        const chunk = keys.slice(i, i + PIPELINE_BATCH);
        const pipe = redis.pipeline();
        for (const k of chunk) {
          pipe.get(pk(k));
          pipe.ttl(pk(k));
        }
        const pipeResults = await pipe.exec();
        for (let j = 0; j < chunk.length; j++) {
          const rawResult = pipeResults?.[j * 2];
          const ttlResult = pipeResults?.[j * 2 + 1];
          const raw = rawResult ? (rawResult[1] as string | null) : null;
          const ttl = ttlResult ? (ttlResult[1] as number) : -2;
          let schema: number | null = null;
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as { v?: number };
              schema = parsed.v ?? null;
            } catch { /* unreadable */ }
          }
          results.push({ ttl: ttl ?? -2, schema });
        }
      }
      return results;
    },

    async quit() { await redis.quit(); },
  };
}

// ─── D1 / SQLite stats reader ─────────────────────────────────────────────────

interface CountRow {
  key_type: string;
  schema_version: number;
  count: number;
}

interface DbStatsReader {
  /** Returns per (key_type, schema_version) counts. */
  getCountsByType(): Promise<CountRow[]>;
  /** Returns the number of match IDs that have both 'match' and 'scorecards'
   *  entries at the given schema version. */
  getLabEligibleCount(schemaVersion: number): Promise<number>;
  close(): void;
}

function getD1DatabaseId(): string {
  const tomlPath = join(process.cwd(), "wrangler.toml");
  if (!existsSync(tomlPath)) throw new Error("wrangler.toml not found — run from repo root");
  const content = readFileSync(tomlPath, "utf-8");
  const match = content.match(/^\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Could not find [[d1_databases]] database_id in wrangler.toml");
  return match[1];
}

function createD1Reader(): DbStatsReader {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(
      "D1 target requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars.",
    );
  }
  const dbId = getD1DatabaseId();
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
  console.log(`D1    : account=${accountId.slice(0, 8)}…  db=${dbId.slice(0, 8)}…`);

  async function runSql<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const resp = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`D1 API ${resp.status}: ${body.slice(0, 200)}`);
    }
    const result = await resp.json() as {
      success: boolean;
      errors?: Array<{ message: string }>;
      result?: Array<{ results: T[] }>;
    };
    if (!result.success) {
      throw new Error(`D1 query failed: ${result.errors?.[0]?.message ?? "unknown"}`);
    }
    return result.result?.[0]?.results ?? [];
  }

  return {
    async getCountsByType() {
      return runSql<CountRow>(
        `SELECT key_type, schema_version, COUNT(*) as count
         FROM match_data_cache
         GROUP BY key_type, schema_version
         ORDER BY key_type, schema_version DESC`,
      );
    },
    async getLabEligibleCount(schemaVersion) {
      const rows = await runSql<{ n: number }>(
        `SELECT COUNT(DISTINCT m.match_id) as n
         FROM match_data_cache m
         JOIN match_data_cache s ON m.ct = s.ct AND m.match_id = s.match_id
         WHERE m.key_type = 'match'      AND m.schema_version = ?
           AND s.key_type = 'scorecards' AND s.schema_version = ?`,
        [schemaVersion, schemaVersion],
      );
      return rows[0]?.n ?? 0;
    },
    close() { /* no-op */ },
  };
}

function createSqliteReader(dbPath: string): DbStatsReader {
  const db = new Database(dbPath, { readonly: true });
  console.log(`SQLite: ${dbPath}`);

  return {
    async getCountsByType() {
      const rows = db
        .prepare(
          `SELECT key_type, schema_version, COUNT(*) as count
           FROM match_data_cache
           GROUP BY key_type, schema_version
           ORDER BY key_type, schema_version DESC`,
        )
        .all() as CountRow[];
      return rows;
    },
    async getLabEligibleCount(schemaVersion) {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT m.match_id) as n
           FROM match_data_cache m
           JOIN match_data_cache s ON m.ct = s.ct AND m.match_id = s.match_id
           WHERE m.key_type = 'match'      AND m.schema_version = ?
             AND s.key_type = 'scorecards' AND s.schema_version = ?`,
        )
        .get(schemaVersion, schemaVersion) as { n: number } | undefined;
      return row?.n ?? 0;
    },
    close() { db.close(); },
  };
}

// ─── Stats aggregation ────────────────────────────────────────────────────────

interface RedisKeyTypeStats {
  total: number;
  permanent: number;  // TTL = -1
  hasTtl: number;    // TTL >= 0
  schemaCurrent: number;
  schemaOld: number;
  schemaUnknown: number;
}

function emptyRedisStats(): RedisKeyTypeStats {
  return { total: 0, permanent: 0, hasTtl: 0, schemaCurrent: 0, schemaOld: 0, schemaUnknown: 0 };
}

function classifyRedisKey(meta: KeyMeta, acc: RedisKeyTypeStats): void {
  acc.total++;
  if (meta.ttl === -1) acc.permanent++;
  else if (meta.ttl >= 0) acc.hasTtl++;
  if (meta.schema === CACHE_SCHEMA_VERSION) acc.schemaCurrent++;
  else if (meta.schema !== null) acc.schemaOld++;
  else acc.schemaUnknown++;
}

// ─── Output formatting ────────────────────────────────────────────────────────

const W = 68; // total table width

function hr(char = "─"): string { return char.repeat(W); }

function row(
  label: string,
  cols: Array<string | number>,
  widths: number[],
): string {
  const cells = [label.padEnd(widths[0]), ...cols.map((c, i) => String(c).padStart(widths[i + 1]))];
  return "  " + cells.join("  ");
}

function header(cols: string[], widths: number[]): string {
  return row(cols[0], cols.slice(1), widths);
}

function printRedisSection(
  match: RedisKeyTypeStats,
  scorecards: RedisKeyTypeStats,
  matchglobal: RedisKeyTypeStats,
  labComplete: number,
): void {
  const cols = ["Key type", "Total", "Perm", "TTL", `v=${CACHE_SCHEMA_VERSION}`, "Old", "Unknown"];
  const w = [22, 7, 7, 7, 9, 7, 9];

  console.log("\nRedis / Upstash");
  console.log(hr());
  console.log(header(cols, w));
  console.log(hr("-"));

  for (const [label, s] of [
    ["GetMatch", match],
    ["GetMatchScorecards", scorecards],
    ["matchglobal", matchglobal],
  ] as Array<[string, RedisKeyTypeStats]>) {
    console.log(row(label, [s.total, s.permanent, s.hasTtl, s.schemaCurrent, s.schemaOld, s.schemaUnknown], w));
  }

  console.log(hr("-"));
  console.log(
    `  Lab-complete (GetMatch + GetMatchScorecards, permanent, v=${CACHE_SCHEMA_VERSION}): ${labComplete}`,
  );
  if (match.total > 0) {
    const migratable = Math.min(match.permanent, scorecards.permanent);
    console.log(`  Migratable to D1 (permanent pairs): ~${migratable}`);
  }
}

function printDbSection(
  rows: CountRow[],
  labEligible: number,
  target: string,
): void {
  const byType: Record<string, { current: number; old: number }> = {};
  for (const r of rows) {
    const t = r.key_type;
    if (!byType[t]) byType[t] = { current: 0, old: 0 };
    if (r.schema_version === CACHE_SCHEMA_VERSION) byType[t].current += r.count;
    else byType[t].old += r.count;
  }

  const cols = ["Key type", "Total", `v=${CACHE_SCHEMA_VERSION}`, "Old schema"];
  const w = [22, 7, 9, 11];

  console.log(`\nD1 / SQLite  [${target}]`);
  console.log(hr());
  console.log(header(cols, w));
  console.log(hr("-"));

  const typeOrder = ["match", "scorecards", "matchglobal"];
  const seen = new Set<string>();
  for (const t of [...typeOrder, ...Object.keys(byType)]) {
    if (seen.has(t)) continue;
    seen.add(t);
    const s = byType[t] ?? { current: 0, old: 0 };
    console.log(row(t, [s.current + s.old, s.current, s.old], w));
  }

  console.log(hr("-"));
  console.log(`  Lab-eligible (match + scorecards in D1, v=${CACHE_SCHEMA_VERSION}): ${labEligible}`);
  console.log(`  → "uv run rating sync --force" will pull these ${labEligible} matches`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env.local"));
  const args = parseArgs();

  console.log(`SSI Match Cache Stats — CACHE_SCHEMA_VERSION=${CACHE_SCHEMA_VERSION}`);
  console.log(hr("═"));

  // ── Redis section ────────────────────────────────────────────────────────────

  if (!args.noRedis) {
    const client = await createRedisClient();
    try {
      process.stdout.write("Scanning Redis keys... ");
      const [rawMatchKeys, scorecardsKeys, globalKeys] = await Promise.all([
        client.scanKeys("gql:GetMatch:*"),
        client.scanKeys("gql:GetMatchScorecards:*"),
        client.scanKeys("computed:matchglobal:*"),
      ]);
      // GetMatch scan picks up GetMatchScorecards too — filter them out
      const matchKeys = rawMatchKeys.filter(k => !k.startsWith("gql:GetMatchScorecards:"));
      console.log(
        `found ${matchKeys.length} GetMatch + ${scorecardsKeys.length} GetMatchScorecards + ${globalKeys.length} matchglobal`,
      );

      process.stdout.write("Fetching key metadata (TTL + schema) via pipeline... ");
      const [matchMeta, scorecardsMeta, globalMeta] = await Promise.all([
        client.getKeyMeta(matchKeys),
        client.getKeyMeta(scorecardsKeys),
        client.getKeyMeta(globalKeys),
      ]);
      console.log("done");

      const matchStats = emptyRedisStats();
      const scorecardsStats = emptyRedisStats();
      const globalStats = emptyRedisStats();
      matchMeta.forEach(m => classifyRedisKey(m, matchStats));
      scorecardsMeta.forEach(m => classifyRedisKey(m, scorecardsStats));
      globalMeta.forEach(m => classifyRedisKey(m, globalStats));

      // Lab-complete: match IDs that are permanent AND current schema in BOTH GetMatch + GetMatchScorecards
      const permanentMatchIds = new Set<string>();
      matchKeys.forEach((k, i) => {
        const meta = matchMeta[i];
        if (meta.ttl === -1 && meta.schema === CACHE_SCHEMA_VERSION) {
          const parsed = parseMatchCacheKey(k);
          if (parsed) permanentMatchIds.add(`${parsed.ct}:${parsed.matchId}`);
        }
      });
      let labComplete = 0;
      scorecardsKeys.forEach((k, i) => {
        const meta = scorecardsMeta[i];
        if (meta.ttl === -1 && meta.schema === CACHE_SCHEMA_VERSION) {
          const parsed = parseMatchCacheKey(k);
          if (parsed && permanentMatchIds.has(`${parsed.ct}:${parsed.matchId}`)) labComplete++;
        }
      });

      printRedisSection(matchStats, scorecardsStats, globalStats, labComplete);
    } finally {
      await client.quit();
    }
  }

  // ── D1 / SQLite section ──────────────────────────────────────────────────────

  if (!args.noDb) {
    let dbReader: DbStatsReader;
    if (args.target === "d1") {
      dbReader = createD1Reader();
    } else {
      const dbPath = process.env.SHOOTER_DB_PATH ?? "./data/shooter-index.db";
      dbReader = createSqliteReader(dbPath);
    }

    try {
      const [counts, labEligible] = await Promise.all([
        dbReader.getCountsByType(),
        dbReader.getLabEligibleCount(CACHE_SCHEMA_VERSION),
      ]);
      printDbSection(counts, labEligible, args.target);
    } finally {
      dbReader.close();
    }
  }

  console.log("\n" + hr("═"));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
