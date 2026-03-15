// Server-only — D1-backed AppDatabase (Cloudflare Pages target).
// Never import from client components or files with "use client".
// Never import ioredis, better-sqlite3, or any Node.js-only module from this file.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AppDatabase } from "@/lib/db";
import type { MatchRecord } from "@/lib/types";

// Minimal D1Database type for the binding. The full type comes from
// @cloudflare/workers-types which is a devDep of the opennextjs package.
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result<unknown>>;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T> {
  results: T[];
  success: boolean;
}

// Schema is managed by migrations/*.sql applied via:
//   wrangler d1 migrations apply APP_DB [--env staging]
// This runs automatically in CI before each deploy (see deploy-cloudflare.yml
// and deploy-staging.yml). No runtime schema init needed here.
function getDb(): D1Database {
  const { env } = getCloudflareContext() as unknown as { env: { APP_DB: D1Database } };
  return env.APP_DB;
}

const db: AppDatabase = {
  async indexShooterMatch(shooterId, matchRef, startTimestamp) {
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO shooter_matches (shooter_id, match_ref, start_timestamp)
         VALUES (?, ?, ?)
         ON CONFLICT(shooter_id, match_ref)
         DO UPDATE SET start_timestamp = excluded.start_timestamp`,
      )
      .bind(shooterId, matchRef, startTimestamp)
      .run();
  },

  async setShooterProfile(shooterId, profile) {
    const db = getDb();
    await db
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
      .bind(
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
      )
      .run();
  },

  async getShooterMatches(shooterId) {
    const db = getDb();
    const result = await db
      .prepare(
        `SELECT match_ref FROM shooter_matches
         WHERE shooter_id = ?
         ORDER BY start_timestamp ASC`,
      )
      .bind(shooterId)
      .all<{ match_ref: string }>();
    return result.results.map((r) => r.match_ref);
  },

  async getUpcomingMatches(shooterId) {
    const now = Math.floor(Date.now() / 1000);
    const db = getDb();
    const result = await db
      .prepare(
        `SELECT match_ref FROM shooter_matches
         WHERE shooter_id = ? AND start_timestamp > ?
         ORDER BY start_timestamp ASC`,
      )
      .bind(shooterId, now)
      .all<{ match_ref: string }>();
    return result.results.map((r) => r.match_ref);
  },

  async getShooterProfile(shooterId) {
    const db = getDb();
    const row = await db
      .prepare(
        `SELECT name, club, division, last_seen, region, region_display, category, ics_alias, license
         FROM shooter_profiles WHERE shooter_id = ?`,
      )
      .bind(shooterId)
      .first<{
        name: string;
        club: string | null;
        division: string | null;
        last_seen: string;
        region: string | null;
        region_display: string | null;
        category: string | null;
        ics_alias: string | null;
        license: string | null;
      }>();
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
    const db = getDb();
    const row = await db
      .prepare(`SELECT 1 AS found FROM shooter_profiles WHERE shooter_id = ?`)
      .bind(shooterId)
      .first();
    return row !== null;
  },

  async getShooterAchievements(shooterId) {
    const db = getDb();
    const result = await db
      .prepare(
        `SELECT achievement_id, tier, unlocked_at, match_ref, value
         FROM shooter_achievements
         WHERE shooter_id = ?
         ORDER BY achievement_id, tier`,
      )
      .bind(shooterId)
      .all<{
        achievement_id: string;
        tier: number;
        unlocked_at: string;
        match_ref: string | null;
        value: number | null;
      }>();
    return result.results.map((r) => ({
      achievementId: r.achievement_id,
      tier: r.tier,
      unlockedAt: r.unlocked_at,
      matchRef: r.match_ref,
      value: r.value,
    }));
  },

  async saveShooterAchievements(shooterId, achievements) {
    if (achievements.length === 0) return;
    const db = getDb();
    const stmts = achievements.map((a) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO shooter_achievements
             (shooter_id, achievement_id, tier, unlocked_at, match_ref, value)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          shooterId,
          a.achievementId,
          a.tier,
          a.unlockedAt,
          a.matchRef ?? null,
          a.value ?? null,
        ),
    );
    await db.batch(stmts);
  },

  async searchShooterProfiles(query, options) {
    const limit = Math.min(options?.limit ?? 20, 100);
    const db = getDb();
    type Row = { shooter_id: number; name: string; club: string | null; division: string | null; last_seen: string };
    const toResult = (r: Row) => ({ shooterId: r.shooter_id, name: r.name, club: r.club, division: r.division, lastSeen: r.last_seen });
    const notSuppressed = `AND shooter_id NOT IN (SELECT shooter_id FROM shooter_suppressions)`;
    if (!query) {
      const result = await db
        .prepare(`SELECT shooter_id, name, club, division, last_seen FROM shooter_profiles WHERE 1=1 ${notSuppressed} ORDER BY last_seen DESC LIMIT ?`)
        .bind(limit)
        .all<Row>();
      return result.results.map(toResult);
    }
    const escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const result = await db
      .prepare(
        `SELECT shooter_id, name, club, division, last_seen FROM shooter_profiles
         WHERE name LIKE '%' || ? || '%' ESCAPE '\\' ${notSuppressed}
         ORDER BY last_seen DESC LIMIT ?`,
      )
      .bind(escaped, limit)
      .all<Row>();
    return result.results.map(toResult);
  },

  async recordMatchAccess(key) {
    const now = Math.floor(Date.now() / 1000);
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO match_popularity (cache_key, last_seen_at, hit_count)
         VALUES (?, ?, 1)
         ON CONFLICT(cache_key)
         DO UPDATE SET last_seen_at = excluded.last_seen_at,
                       hit_count = hit_count + 1`,
      )
      .bind(key, now)
      .run();
  },

  async getPopularKeys(maxAgeSeconds, limit) {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
    const db = getDb();

    // Prune stale entries
    await db
      .prepare(`DELETE FROM match_popularity WHERE last_seen_at < ?`)
      .bind(cutoff)
      .run();

    const result = await db
      .prepare(
        `SELECT cache_key, hit_count FROM match_popularity
         WHERE last_seen_at >= ?
         ORDER BY hit_count DESC
         LIMIT ?`,
      )
      .bind(cutoff, limit)
      .all<{ cache_key: string; hit_count: number }>();

    return result.results.map((r) => ({ key: r.cache_key, hits: r.hit_count }));
  },

  // ── Match data cache ──────────────────────────────────────────────────

  async getMatchDataCache(cacheKey) {
    const db = getDb();
    const row = await db
      .prepare(`SELECT data FROM match_data_cache WHERE cache_key = ?`)
      .bind(cacheKey)
      .first<{ data: string }>();
    return row?.data ?? null;
  },

  async setMatchDataCache(cacheKey, data, meta) {
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO match_data_cache (cache_key, key_type, ct, match_id, data, schema_version, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(cache_key)
         DO UPDATE SET data = excluded.data,
                       schema_version = excluded.schema_version,
                       stored_at = excluded.stored_at`,
      )
      .bind(cacheKey, meta.keyType, meta.ct, meta.matchId, data, meta.schemaVersion)
      .run();
  },

  async deleteMatchDataCache(...cacheKeys) {
    if (cacheKeys.length === 0) return;
    const db = getDb();
    // D1 doesn't support variadic bind — delete one at a time
    const stmts = cacheKeys.map((key) =>
      db.prepare(`DELETE FROM match_data_cache WHERE cache_key = ?`).bind(key),
    );
    await db.batch(stmts);
  },

  async scanMatchDataCacheKeys(keyType?) {
    const db = getDb();
    if (keyType) {
      const result = await db
        .prepare(`SELECT cache_key FROM match_data_cache WHERE key_type = ?`)
        .bind(keyType)
        .all<{ cache_key: string }>();
      return result.results.map((r) => r.cache_key);
    }
    const result = await db
      .prepare(`SELECT cache_key FROM match_data_cache`)
      .all<{ cache_key: string }>();
    return result.results.map((r) => r.cache_key);
  },

  async listMatchCacheEntries(options) {
    const d = getDb();
    type Row = { cache_key: string; key_type: string; ct: number; match_id: string; stored_at: string; data?: string };
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (options?.keyType) {
      conditions.push("key_type = ?");
      binds.push(options.keyType);
    }
    if (options?.since) {
      conditions.push("stored_at >= ?");
      binds.push(options.since);
    }
    const cols = options?.includeData
      ? "cache_key, key_type, ct, match_id, stored_at, data"
      : "cache_key, key_type, ct, match_id, stored_at";
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    let stmt = d.prepare(`SELECT ${cols} FROM match_data_cache${where} ORDER BY stored_at DESC`);
    if (binds.length > 0) stmt = stmt.bind(...binds);
    const result = await stmt.all<Row>();
    return result.results.map((r) => ({
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
    const db = getDb();
    await db
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
      .bind(
        match.matchRef, match.ct, match.matchId, match.name,
        match.venue, match.date, match.level, match.region,
        match.subRule, match.discipline, match.status, match.resultsStatus,
        match.scoringCompleted, match.competitorsCount, match.stagesCount,
        match.lat, match.lng, match.data, match.updatedAt,
      )
      .run();
  },

  async getMatchesByRefs(matchRefs) {
    if (matchRefs.length === 0) return new Map<string, MatchRecord>();
    const db = getDb();
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
    const result = await db
      .prepare(
        `SELECT match_ref, ct, match_id, name, venue, date, level, region, sub_rule, discipline,
                status, results_status, scoring_completed, competitors_count, stages_count,
                lat, lng, data, updated_at
         FROM matches WHERE match_ref IN (${placeholders})`,
      )
      .bind(...matchRefs)
      .all<MatchRow>();
    const map = new Map<string, MatchRecord>();
    for (const r of result.results) {
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

  // ── Shooter suppressions (GDPR) ──────────────────────────────────────

  async isShooterSuppressed(shooterId) {
    const db = getDb();
    const row = await db
      .prepare(`SELECT 1 AS found FROM shooter_suppressions WHERE shooter_id = ?`)
      .bind(shooterId)
      .first();
    return row !== null;
  },

  async getAllSuppressedShooterIds() {
    const db = getDb();
    const result = await db
      .prepare(`SELECT shooter_id FROM shooter_suppressions`)
      .all<{ shooter_id: number }>();
    return new Set(result.results.map((r) => r.shooter_id));
  },

  async suppressShooter(shooterId) {
    const db = getDb();
    await db.batch([
      db.prepare(
        `INSERT OR IGNORE INTO shooter_suppressions (shooter_id, suppressed_at)
         VALUES (?, datetime('now'))`,
      ).bind(shooterId),
      db.prepare(`DELETE FROM shooter_profiles WHERE shooter_id = ?`).bind(shooterId),
      db.prepare(`DELETE FROM shooter_matches WHERE shooter_id = ?`).bind(shooterId),
      db.prepare(`DELETE FROM shooter_achievements WHERE shooter_id = ?`).bind(shooterId),
    ]);
  },
};

export default db;
