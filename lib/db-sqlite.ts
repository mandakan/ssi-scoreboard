// Server-only — SQLite-backed AppDatabase (Node.js / Docker target).
// Never import from client components or files with "use client".

import Database from "better-sqlite3";
import path from "path";
import type { AppDatabase } from "@/lib/db";
import type { MatchRecord } from "@/lib/types";
import { runMigrationsSync } from "@/lib/db-migrations";
import type { SyncMigrationExecutor } from "@/lib/db-migrations";

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  // Run schema migrations synchronously on first open
  const executor: SyncMigrationExecutor = {
    exec(sql) { db.exec(sql); },
    getVersion() {
      const row = db.prepare(
        `SELECT version FROM _schema_version WHERE id = 1`,
      ).get() as { version: number } | undefined;
      return row?.version ?? 0;
    },
    setVersion(version) {
      db.prepare(
        `INSERT INTO _schema_version (id, version) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
      ).run(version);
    },
  };
  runMigrationsSync(executor);

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
          `INSERT INTO shooter_profiles (shooter_id, name, club, division, last_seen, region, region_display, category, ics_alias, license)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(shooter_id)
           DO UPDATE SET name = excluded.name,
                         club = excluded.club,
                         division = excluded.division,
                         last_seen = excluded.last_seen,
                         region = excluded.region,
                         region_display = excluded.region_display,
                         category = excluded.category,
                         ics_alias = excluded.ics_alias,
                         license = excluded.license`,
        )
        .run(
          shooterId,
          profile.name,
          profile.club ?? null,
          profile.division ?? null,
          profile.lastSeen,
          profile.region ?? null,
          profile.region_display ?? null,
          profile.category ?? null,
          profile.ics_alias ?? null,
          profile.license ?? null,
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
          `SELECT name, club, division, last_seen, region, region_display, category, ics_alias, license
           FROM shooter_profiles WHERE shooter_id = ?`,
        )
        .get(shooterId) as
        | {
            name: string;
            club: string | null;
            division: string | null;
            last_seen: string;
            region: string | null;
            region_display: string | null;
            category: string | null;
            ics_alias: string | null;
            license: string | null;
          }
        | undefined;
      if (!row) return null;
      return {
        name: row.name,
        club: row.club,
        division: row.division,
        lastSeen: row.last_seen,
        region: row.region,
        region_display: row.region_display,
        category: row.category,
        ics_alias: row.ics_alias,
        license: row.license,
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
      type Row = { cache_key: string; key_type: string; ct: number; match_id: string; stored_at: string; data?: string };
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
      const cols = options?.includeData
        ? "cache_key, key_type, ct, match_id, stored_at, data"
        : "cache_key, key_type, ct, match_id, stored_at";
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
      const rows = d
        .prepare(`SELECT ${cols} FROM match_data_cache${where} ORDER BY stored_at DESC`)
        .all(...params) as Row[];
      return rows.map((r) => ({
        cacheKey: r.cache_key,
        keyType: r.key_type,
        ct: r.ct,
        matchId: r.match_id,
        storedAt: r.stored_at,
        ...(r.data != null ? { data: r.data } : {}),
      }));
    },

    // ── Matches domain index ────────────────────────────────────────────────

    async upsertMatch(match) {
      getDb()
        .prepare(
          `INSERT INTO matches (match_ref, ct, match_id, name, venue, date, level, region, sub_rule, discipline, status, results_status, scoring_completed, competitors_count, stages_count, lat, lng, data, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(match_ref)
           DO UPDATE SET name = excluded.name,
                         venue = excluded.venue,
                         date = excluded.date,
                         level = excluded.level,
                         region = excluded.region,
                         sub_rule = excluded.sub_rule,
                         discipline = excluded.discipline,
                         status = excluded.status,
                         results_status = excluded.results_status,
                         scoring_completed = excluded.scoring_completed,
                         competitors_count = excluded.competitors_count,
                         stages_count = excluded.stages_count,
                         lat = excluded.lat,
                         lng = excluded.lng,
                         data = excluded.data,
                         updated_at = excluded.updated_at`,
        )
        .run(
          match.matchRef, match.ct, match.matchId, match.name,
          match.venue, match.date, match.level, match.region,
          match.subRule, match.discipline, match.status, match.resultsStatus,
          match.scoringCompleted, match.competitorsCount, match.stagesCount,
          match.lat, match.lng, match.data, match.updatedAt,
        );
    },

    async getMatchesByRefs(matchRefs) {
      if (matchRefs.length === 0) return new Map<string, MatchRecord>();
      const d = getDb();
      const placeholders = matchRefs.map(() => "?").join(",");
      type MatchRow = {
        match_ref: string; ct: number; match_id: string; name: string;
        venue: string | null; date: string | null; level: string | null;
        region: string | null; sub_rule: string | null; discipline: string | null;
        status: string | null; results_status: string | null;
        scoring_completed: number; competitors_count: number | null;
        stages_count: number | null; lat: number | null; lng: number | null;
        data: string | null; updated_at: string;
      };
      const rows = d
        .prepare(
          `SELECT match_ref, ct, match_id, name, venue, date, level, region, sub_rule, discipline,
                  status, results_status, scoring_completed, competitors_count, stages_count,
                  lat, lng, data, updated_at
           FROM matches WHERE match_ref IN (${placeholders})`,
        )
        .all(...matchRefs) as MatchRow[];
      const map = new Map<string, MatchRecord>();
      for (const r of rows) {
        map.set(r.match_ref, {
          matchRef: r.match_ref, ct: r.ct, matchId: r.match_id, name: r.name,
          venue: r.venue, date: r.date, level: r.level, region: r.region,
          subRule: r.sub_rule, discipline: r.discipline, status: r.status,
          resultsStatus: r.results_status, scoringCompleted: r.scoring_completed,
          competitorsCount: r.competitors_count, stagesCount: r.stages_count,
          lat: r.lat, lng: r.lng, data: r.data, updatedAt: r.updated_at,
        });
      }
      return map;
    },
  };
}

const defaultDb = createSqliteDatabase();
export default defaultDb;
