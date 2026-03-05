// Server-only — SQLite-backed AppDatabase (Node.js / Docker target).
// Never import from client components or files with "use client".

import Database from "better-sqlite3";
import path from "path";
import type { AppDatabase } from "@/lib/db";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS shooter_profiles (
    shooter_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    club TEXT,
    division TEXT,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shooter_matches (
    shooter_id INTEGER NOT NULL,
    match_ref TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    PRIMARY KEY (shooter_id, match_ref)
  );
  CREATE INDEX IF NOT EXISTS idx_sm_shooter_ts
    ON shooter_matches(shooter_id, start_timestamp);

  CREATE TABLE IF NOT EXISTS shooter_achievements (
    shooter_id INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 1,
    unlocked_at TEXT NOT NULL,
    match_ref TEXT,
    value REAL,
    PRIMARY KEY (shooter_id, achievement_id, tier)
  );
  CREATE INDEX IF NOT EXISTS idx_sa_shooter
    ON shooter_achievements(shooter_id);

  CREATE TABLE IF NOT EXISTS match_popularity (
    cache_key TEXT PRIMARY KEY,
    last_seen_at INTEGER NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_mp_last_seen
    ON match_popularity(last_seen_at);

  CREATE TABLE IF NOT EXISTS match_data_cache (
    cache_key      TEXT PRIMARY KEY,
    key_type       TEXT NOT NULL,
    ct             INTEGER NOT NULL,
    match_id       TEXT NOT NULL,
    data           TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    stored_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mdc_match ON match_data_cache(ct, match_id);
  CREATE INDEX IF NOT EXISTS idx_mdc_key_type ON match_data_cache(key_type);
`;

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  return db;
}

export function createSqliteDatabase(
  dbPath?: string,
): AppDatabase {
  let db: Database.Database | null = null;

  function getDb(): Database.Database {
    if (!db) {
      const resolved =
        dbPath ??
        (process.env.SHOOTER_DB_PATH ||
          path.join(process.cwd(), "data", "shooter-index.db"));

      // Ensure the directory exists (skip for :memory:)
      if (resolved !== ":memory:") {
        const dir = path.dirname(resolved);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("fs") as typeof import("fs");
        fs.mkdirSync(dir, { recursive: true });
      }

      db = openDb(resolved);
    }
    return db;
  }

  return {
    async indexShooterMatch(shooterId, matchRef, startTimestamp) {
      const d = getDb();
      d.prepare(
        `INSERT INTO shooter_matches (shooter_id, match_ref, start_timestamp)
         VALUES (?, ?, ?)
         ON CONFLICT(shooter_id, match_ref)
         DO UPDATE SET start_timestamp = excluded.start_timestamp`,
      ).run(shooterId, matchRef, startTimestamp);
    },

    async setShooterProfile(shooterId, profile) {
      getDb()
        .prepare(
          `INSERT INTO shooter_profiles (shooter_id, name, club, division, last_seen)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(shooter_id)
           DO UPDATE SET name = excluded.name,
                         club = excluded.club,
                         division = excluded.division,
                         last_seen = excluded.last_seen`,
        )
        .run(
          shooterId,
          profile.name,
          profile.club ?? null,
          profile.division ?? null,
          profile.lastSeen,
        );
    },

    async getShooterMatches(shooterId) {
      const rows = getDb()
        .prepare(
          `SELECT match_ref FROM shooter_matches
           WHERE shooter_id = ?
           ORDER BY start_timestamp ASC`,
        )
        .all(shooterId) as { match_ref: string }[];
      return rows.map((r) => r.match_ref);
    },

    async getUpcomingMatches(shooterId) {
      const now = Math.floor(Date.now() / 1000);
      const rows = getDb()
        .prepare(
          `SELECT match_ref FROM shooter_matches
           WHERE shooter_id = ? AND start_timestamp > ?
           ORDER BY start_timestamp ASC`,
        )
        .all(shooterId, now) as { match_ref: string }[];
      return rows.map((r) => r.match_ref);
    },

    async getShooterProfile(shooterId) {
      const row = getDb()
        .prepare(
          `SELECT name, club, division, last_seen FROM shooter_profiles
           WHERE shooter_id = ?`,
        )
        .get(shooterId) as
        | { name: string; club: string | null; division: string | null; last_seen: string }
        | undefined;
      if (!row) return null;
      return {
        name: row.name,
        club: row.club,
        division: row.division,
        lastSeen: row.last_seen,
      };
    },

    async hasShooterProfile(shooterId) {
      const row = getDb()
        .prepare(
          `SELECT 1 FROM shooter_profiles WHERE shooter_id = ?`,
        )
        .get(shooterId);
      return row !== undefined;
    },

    async recordMatchAccess(key) {
      const now = Math.floor(Date.now() / 1000);
      getDb()
        .prepare(
          `INSERT INTO match_popularity (cache_key, last_seen_at, hit_count)
           VALUES (?, ?, 1)
           ON CONFLICT(cache_key)
           DO UPDATE SET last_seen_at = excluded.last_seen_at,
                         hit_count = hit_count + 1`,
        )
        .run(key, now);
    },

    async getShooterAchievements(shooterId) {
      const rows = getDb()
        .prepare(
          `SELECT achievement_id, tier, unlocked_at, match_ref, value
           FROM shooter_achievements
           WHERE shooter_id = ?
           ORDER BY achievement_id, tier`,
        )
        .all(shooterId) as {
        achievement_id: string;
        tier: number;
        unlocked_at: string;
        match_ref: string | null;
        value: number | null;
      }[];
      return rows.map((r) => ({
        achievementId: r.achievement_id,
        tier: r.tier,
        unlockedAt: r.unlocked_at,
        matchRef: r.match_ref,
        value: r.value,
      }));
    },

    async saveShooterAchievements(shooterId, achievements) {
      if (achievements.length === 0) return;
      const d = getDb();
      const stmt = d.prepare(
        `INSERT OR IGNORE INTO shooter_achievements
           (shooter_id, achievement_id, tier, unlocked_at, match_ref, value)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const tx = d.transaction(() => {
        for (const a of achievements) {
          stmt.run(
            shooterId,
            a.achievementId,
            a.tier,
            a.unlockedAt,
            a.matchRef ?? null,
            a.value ?? null,
          );
        }
      });
      tx();
    },

    async searchShooterProfiles(query, options) {
      const limit = Math.min(options?.limit ?? 20, 100);
      const d = getDb();
      type Row = { shooter_id: number; name: string; club: string | null; division: string | null; last_seen: string };
      const toResult = (r: Row) => ({ shooterId: r.shooter_id, name: r.name, club: r.club, division: r.division, lastSeen: r.last_seen });
      if (!query) {
        const rows = d.prepare(
          `SELECT shooter_id, name, club, division, last_seen FROM shooter_profiles ORDER BY last_seen DESC LIMIT ?`,
        ).all(limit) as Row[];
        return rows.map(toResult);
      }
      // Escape LIKE wildcards so user input is treated literally.
      const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
      const rows = d.prepare(
        `SELECT shooter_id, name, club, division, last_seen FROM shooter_profiles
         WHERE name LIKE '%' || ? || '%' ESCAPE '\\'
         ORDER BY last_seen DESC LIMIT ?`,
      ).all(escaped, limit) as Row[];
      return rows.map(toResult);
    },

    async getPopularKeys(maxAgeSeconds, limit) {
      const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
      const d = getDb();

      // Prune stale entries
      d.prepare(`DELETE FROM match_popularity WHERE last_seen_at < ?`).run(
        cutoff,
      );

      // Fetch top by hit count
      const rows = d
        .prepare(
          `SELECT cache_key, hit_count FROM match_popularity
           WHERE last_seen_at >= ?
           ORDER BY hit_count DESC
           LIMIT ?`,
        )
        .all(cutoff, limit) as { cache_key: string; hit_count: number }[];

      return rows.map((r) => ({ key: r.cache_key, hits: r.hit_count }));
    },

    // ── Match data cache ──────────────────────────────────────────────────

    async getMatchDataCache(cacheKey) {
      const row = getDb()
        .prepare(`SELECT data FROM match_data_cache WHERE cache_key = ?`)
        .get(cacheKey) as { data: string } | undefined;
      return row?.data ?? null;
    },

    async setMatchDataCache(cacheKey, data, meta) {
      getDb()
        .prepare(
          `INSERT INTO match_data_cache (cache_key, key_type, ct, match_id, data, schema_version, stored_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(cache_key)
           DO UPDATE SET data = excluded.data,
                         schema_version = excluded.schema_version,
                         stored_at = excluded.stored_at`,
        )
        .run(cacheKey, meta.keyType, meta.ct, meta.matchId, data, meta.schemaVersion);
    },

    async deleteMatchDataCache(...cacheKeys) {
      if (cacheKeys.length === 0) return;
      const d = getDb();
      const placeholders = cacheKeys.map(() => "?").join(",");
      d.prepare(`DELETE FROM match_data_cache WHERE cache_key IN (${placeholders})`).run(
        ...cacheKeys,
      );
    },

    async scanMatchDataCacheKeys(keyType?) {
      const d = getDb();
      if (keyType) {
        const rows = d
          .prepare(`SELECT cache_key FROM match_data_cache WHERE key_type = ?`)
          .all(keyType) as { cache_key: string }[];
        return rows.map((r) => r.cache_key);
      }
      const rows = d
        .prepare(`SELECT cache_key FROM match_data_cache`)
        .all() as { cache_key: string }[];
      return rows.map((r) => r.cache_key);
    },

    async listMatchCacheEntries(options) {
      const d = getDb();
      type Row = { cache_key: string; key_type: string; ct: number; match_id: string; stored_at: string };
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (options?.keyType) {
        conditions.push("key_type = ?");
        params.push(options.keyType);
      }
      if (options?.since) {
        conditions.push("stored_at >= ?");
        params.push(options.since);
      }
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const rows = d
        .prepare(`SELECT cache_key, key_type, ct, match_id, stored_at FROM match_data_cache${where} ORDER BY stored_at DESC`)
        .all(...params) as Row[];
      return rows.map((r) => ({
        cacheKey: r.cache_key,
        keyType: r.key_type,
        ct: r.ct,
        matchId: r.match_id,
        storedAt: r.stored_at,
      }));
    },
  };
}

const defaultDb = createSqliteDatabase();
export default defaultDb;
