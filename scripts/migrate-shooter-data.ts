#!/usr/bin/env node
/**
 * One-time migration: Redis shooter data → SQLite or Cloudflare D1.
 *
 * Reads existing shooter profiles, match sorted sets, and popularity data
 * from Redis and writes them to the AppDatabase.
 *
 * Usage (from repo root):
 *
 *   # Docker target — write directly to SQLite:
 *   pnpm tsx scripts/migrate-shooter-data.ts [--db-path path/to/db] [--cleanup]
 *
 *   # Cloudflare target — export SQL for D1:
 *   pnpm tsx scripts/migrate-shooter-data.ts --export-sql migration.sql [--cleanup]
 *   wrangler d1 execute APP_DB --remote --file migration.sql
 *   wrangler d1 execute APP_DB --remote --file migration.sql --env staging
 *
 * Options:
 *   --db-path <path>      Path to the SQLite database file
 *                         (default: data/shooter-index.db, SQLite mode only)
 *   --export-sql <path>   Export idempotent SQL INSERT statements to a file
 *                         instead of writing to SQLite. Use this for D1.
 *                         Hit counts are exact (copied from Redis).
 *   --cleanup             After migrating, delete all permanent (no-TTL) shooter
 *                         and popularity keys from Redis to free Upstash quota.
 *                         Deletes: shooter:*:profile, shooter:*:matches,
 *                                  popular:matches:seen, popular:matches:hits
 *
 * Prerequisites:
 *   - REDIS_URL or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set
 *   - .env.local loaded (script loads it automatically)
 *
 * This script is idempotent — re-running it will upsert all data.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import IORedis from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";
import { createSqliteDatabase } from "../lib/db-sqlite";

// ─── .env.local loader ──────────────────────────────────────────────────────

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

// ─── SQL helpers ─────────────────────────────────────────────────────────────

function sqlStr(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

// ─── Redis client ───────────────────────────────────────────────────────────

interface RedisClient {
  scanStream?(opts: { match: string; count: number }): AsyncIterable<string[]>;
  scan?(cursor: string, opts: { match: string; count: number }): Promise<[string, string[]]>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  zrangeWithScores(key: string, start: number, stop: number): Promise<Array<{ member: string; score: number }>>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zscore(key: string, member: string): Promise<number | null>;
  quit(): Promise<void>;
}

async function createRedisClient(): Promise<RedisClient> {
  const prefix = process.env.CACHE_KEY_PREFIX ?? "";
  const pk = (key: string) => `${prefix}${key}`;

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (upstashUrl && upstashToken) {
    const redis = new UpstashRedis({
      url: upstashUrl,
      token: upstashToken,
      automaticDeserialization: false,
    });
    await redis.ping();
    console.log(`Redis: Upstash (${new URL(upstashUrl).hostname})`);
    return {
      async get(key) {
        return redis.get<string>(pk(key));
      },
      async del(key) {
        await redis.del(pk(key));
      },
      async zrangeWithScores(key, start, stop) {
        const raw = (await redis.zrange(pk(key), start, stop, {
          withScores: true,
        })) as (string | number)[];
        const results: Array<{ member: string; score: number }> = [];
        for (let i = 0; i < raw.length; i += 2) {
          results.push({
            member: String(raw[i]),
            score: Number(raw[i + 1]),
          });
        }
        return results;
      },
      async zrange(key, start, stop) {
        return (await redis.zrange(pk(key), start, stop)) as string[];
      },
      async zscore(key, member) {
        const score = await redis.zscore(pk(key), member);
        return score !== null ? Number(score) : null;
      },
      async quit() {
        /* no-op */
      },
      async scan(cursor, opts) {
        return (await redis.scan(cursor, {
          match: opts.match,
          count: opts.count,
        })) as [string, string[]];
      },
    };
  }

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new IORedis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 2,
  });
  await redis.connect();
  console.log(`Redis: ioredis (${redisUrl})`);
  return {
    async get(key) {
      return redis.get(pk(key));
    },
    async del(key) {
      await redis.del(pk(key));
    },
    scanStream(opts) {
      return redis.scanStream({
        match: opts.match,
        count: opts.count,
      });
    },
    async zrangeWithScores(key, start, stop) {
      const raw = await redis.zrange(pk(key), start, stop, "WITHSCORES");
      const results: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < raw.length; i += 2) {
        results.push({ member: raw[i], score: Number(raw[i + 1]) });
      }
      return results;
    },
    async zrange(key, start, stop) {
      return redis.zrange(pk(key), start, stop);
    },
    async zscore(key, member) {
      const score = await redis.zscore(pk(key), member);
      return score !== null ? Number(score) : null;
    },
    async quit() {
      await redis.quit();
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvFile(join(process.cwd(), ".env.local"));

  const args = process.argv.slice(2);

  const dbPathIdx = args.indexOf("--db-path");
  const dbPath =
    dbPathIdx !== -1 && dbPathIdx + 1 < args.length
      ? args[dbPathIdx + 1]
      : undefined;

  const exportSqlIdx = args.indexOf("--export-sql");
  const exportSqlPath =
    exportSqlIdx !== -1 && exportSqlIdx + 1 < args.length
      ? args[exportSqlIdx + 1]
      : undefined;

  const cleanup = args.includes("--cleanup");
  const exportMode = exportSqlPath !== undefined;

  const redis = await createRedisClient();
  const prefix = process.env.CACHE_KEY_PREFIX ?? "";

  console.log(
    exportMode
      ? `Exporting Redis shooter data → SQL (${exportSqlPath})...\n`
      : "Migrating shooter data from Redis → SQLite...\n",
  );

  // ── 1. Scan for shooter profile keys ──────────────────────────────────────
  const profilePattern = `${prefix}shooter:*:profile`;
  const profileKeys: string[] = [];

  if (redis.scanStream) {
    const stream = redis.scanStream({ match: profilePattern, count: 200 });
    for await (const batch of stream) {
      for (const key of batch as string[]) {
        profileKeys.push(
          key.startsWith(prefix) ? key.slice(prefix.length) : key,
        );
      }
    }
  } else if (redis.scan) {
    let cursor = "0";
    do {
      const [nextCursor, batch] = await redis.scan(cursor, {
        match: profilePattern,
        count: 200,
      });
      cursor = nextCursor;
      for (const key of batch) {
        profileKeys.push(
          key.startsWith(prefix) ? key.slice(prefix.length) : key,
        );
      }
    } while (cursor !== "0");
  }

  console.log(`Found ${profileKeys.length} shooter profiles`);

  // ── 2. Collect all data from Redis ────────────────────────────────────────

  type ProfileRow = {
    shooterId: number;
    name: string;
    club: string | null;
    division: string | null;
    lastSeen: string;
  };
  type MatchRow = { shooterId: number; matchRef: string; startTimestamp: number };

  const profiles: ProfileRow[] = [];
  const matches: MatchRow[] = [];

  for (const profileKey of profileKeys) {
    const match = /^shooter:(\d+):profile$/.exec(profileKey);
    if (!match) continue;
    const shooterId = parseInt(match[1], 10);

    const profileRaw = await redis.get(profileKey);
    if (!profileRaw) continue;

    try {
      const p = JSON.parse(profileRaw) as {
        name: string;
        club: string | null;
        division: string | null;
        lastSeen: string;
      };
      profiles.push({ shooterId, ...p });
    } catch {
      console.error(`  Skipping malformed profile for shooter ${shooterId}`);
      continue;
    }

    const matchesKey = `shooter:${shooterId}:matches`;
    const entries = await redis.zrangeWithScores(matchesKey, 0, -1);
    for (const { member, score } of entries) {
      matches.push({ shooterId, matchRef: member, startTimestamp: score });
    }
  }

  // ── 3. Popularity data ────────────────────────────────────────────────────

  const seenKey = "popular:matches:seen";
  const hitsKey = "popular:matches:hits";
  const seenEntries = await redis.zrangeWithScores(seenKey, 0, -1);

  type PopularityRow = { key: string; lastSeenAt: number; hitCount: number };
  const popularity: PopularityRow[] = [];

  for (const { member: key, score: lastSeenAt } of seenEntries) {
    const hits = await redis.zscore(hitsKey, key);
    if (hits == null) continue;
    popularity.push({ key, lastSeenAt: Math.floor(lastSeenAt), hitCount: Math.floor(hits) });
  }

  // ── 4. Write to target ────────────────────────────────────────────────────

  if (exportMode) {
    // Generate idempotent SQL file for D1 (wrangler d1 execute --file)
    const lines: string[] = [
      "-- AppDatabase migration from Redis",
      `-- Generated: ${new Date().toISOString()}`,
      `-- Apply with: wrangler d1 execute APP_DB --remote --file ${exportSqlPath}`,
      "",
    ];

    for (const p of profiles) {
      lines.push(
        `INSERT INTO shooter_profiles (shooter_id, name, club, division, last_seen)` +
        ` VALUES (${p.shooterId}, ${sqlStr(p.name)}, ${sqlStr(p.club)}, ${sqlStr(p.division)}, ${sqlStr(p.lastSeen)})` +
        ` ON CONFLICT(shooter_id) DO UPDATE SET name=excluded.name, club=excluded.club, division=excluded.division, last_seen=excluded.last_seen;`,
      );
    }

    for (const m of matches) {
      lines.push(
        `INSERT INTO shooter_matches (shooter_id, match_ref, start_timestamp)` +
        ` VALUES (${m.shooterId}, ${sqlStr(m.matchRef)}, ${m.startTimestamp})` +
        ` ON CONFLICT(shooter_id, match_ref) DO UPDATE SET start_timestamp=excluded.start_timestamp;`,
      );
    }

    for (const p of popularity) {
      lines.push(
        `INSERT INTO match_popularity (cache_key, last_seen_at, hit_count)` +
        ` VALUES (${sqlStr(p.key)}, ${p.lastSeenAt}, ${p.hitCount})` +
        ` ON CONFLICT(cache_key) DO UPDATE SET last_seen_at=excluded.last_seen_at, hit_count=excluded.hit_count;`,
      );
    }

    writeFileSync(exportSqlPath!, lines.join("\n") + "\n", "utf-8");
    console.log(
      `Exported ${profiles.length} profiles, ${matches.length} match refs, ${popularity.length} popularity entries`,
    );
    console.log(`\nSQL file written to: ${exportSqlPath}`);
    console.log(`Apply with:`);
    console.log(`  wrangler d1 execute APP_DB --remote --file ${exportSqlPath}`);
    console.log(`  wrangler d1 execute APP_DB --remote --file ${exportSqlPath} --env staging`);
  } else {
    // Write directly to SQLite
    const appDb = createSqliteDatabase(dbPath);

    for (const p of profiles) {
      await appDb.setShooterProfile(p.shooterId, {
        name: p.name,
        club: p.club,
        division: p.division,
        lastSeen: p.lastSeen,
        region: null,
        region_display: null,
        category: null,
        ics_alias: null,
        license: null,
      });
    }

    for (const m of matches) {
      await appDb.indexShooterMatch(m.shooterId, m.matchRef, m.startTimestamp);
    }

    for (const p of popularity) {
      await appDb.recordMatchAccess(p.key);
      // Note: hit_count will be 1 (interface limitation). Use --export-sql
      // mode for exact counts if needed.
    }

    console.log(
      `Migrated ${profiles.length} profiles, ${matches.length} match refs, ${popularity.length} popularity entries`,
    );
  }

  // ── 5. Cleanup: delete permanent Redis keys (no TTL) ──────────────────────
  if (cleanup) {
    console.log("\nCleaning up permanent Redis keys...");
    let deleted = 0;

    for (const profileKey of profileKeys) {
      const match = /^shooter:(\d+):profile$/.exec(profileKey);
      if (!match) continue;
      const shooterId = match[1];
      await redis.del(`shooter:${shooterId}:profile`);
      await redis.del(`shooter:${shooterId}:matches`);
      deleted += 2;
    }

    await redis.del(seenKey);
    await redis.del(hitsKey);
    deleted += 2;

    console.log(`Deleted ${deleted} Redis keys`);
  }

  await redis.quit();
  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
