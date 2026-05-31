// Server-only — D1-backed AppDatabase (Cloudflare Pages target).
// Never import from client components or files with "use client".
// Never import ioredis, better-sqlite3, or any Node.js-only module from this file.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AppDatabase } from "@/lib/db";
import type { MatchRecord, ServiceAccountAccessRow } from "@/lib/types";

// Minimal D1Database type for the binding. The full type comes from
// @cloudflare/workers-types which is a devDep of the opennextjs package.
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  withSession(constraintOrBookmark?: string): D1DatabaseSession;
}

// A D1 session opened via withSession(). Queries issued through it may be
// served by a read replica (see readDb()). Exposes the same prepare() surface
// as the binding; we never thread bookmarks across requests so getBookmark()
// is unused here.
interface D1DatabaseSession {
  prepare(query: string): D1PreparedStatement;
  getBookmark(): string | null;
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

/**
 * Read-only D1 handle that may be served by a read replica.
 *
 * D1 read replication (enabled via `read_replication.mode = "auto"` on the
 * database) only routes queries to replicas when they go through the Sessions
 * API — a plain binding query always hits the primary. We open a fresh
 * `first-unconstrained` session per read call, so the query may land on any
 * replica (or the primary), trading a few seconds of possible staleness for
 * primary-offloading headroom during traffic bursts. This is what keeps the
 * primary from queue-overloading ("D1 DB is overloaded") on live-match days.
 *
 * ONLY use this for pure reads where bounded staleness is acceptable. Writes,
 * any read that must observe a write made earlier in the same call (e.g.
 * getPopularKeys prunes then selects), and freshness-critical GDPR/auth reads
 * (suppressions, service-account access) must use getDb() so they hit the
 * primary. When replication is disabled, withSession() still works and every
 * query goes to the primary — so this is safe to ship before flipping the mode.
 */
function readDb(): D1DatabaseSession {
  return getDb().withSession("first-unconstrained");
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
    const db = readDb();
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
    const db = readDb();
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
    const db = readDb();
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
    const db = readDb();
    const row = await db
      .prepare(`SELECT 1 AS found FROM shooter_profiles WHERE shooter_id = ?`)
      .bind(shooterId)
      .first();
    return row !== null;
  },

  async getShooterAchievements(shooterId) {
    const db = readDb();
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
    const db = readDb();
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
    const db = readDb();
    const row = await db
      .prepare(`SELECT data FROM match_data_cache WHERE cache_key = ?`)
      .bind(cacheKey)
      .first<{ data: string }>();
    return row?.data ?? null;
  },

  async getMatchDataCacheStoredAt(cacheKey) {
    const db = readDb();
    const row = await db
      .prepare(`SELECT stored_at FROM match_data_cache WHERE cache_key = ?`)
      .bind(cacheKey)
      .first<{ stored_at: string }>();
    return row?.stored_at ?? null;
  },

  async touchMatchDataCache(cacheKey, when) {
    const db = getDb();
    await db
      .prepare(`UPDATE match_data_cache SET last_accessed_at = ? WHERE cache_key = ?`)
      .bind(when, cacheKey)
      .run();
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
    const db = readDb();
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
    const d = readDb();
    type Row = {
      cache_key: string;
      key_type: string;
      ct: number;
      match_id: string;
      stored_at: string;
      last_accessed_at: string | null;
      data?: string;
    };
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
      ? "cache_key, key_type, ct, match_id, stored_at, last_accessed_at, data"
      : "cache_key, key_type, ct, match_id, stored_at, last_accessed_at";
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
      lastAccessedAt: r.last_accessed_at,
      ...(r.data != null ? { data: r.data } : {}),
    }));
  },

  // ── Matches domain index ────────────────────────────────────────────────

  async upsertMatch(match) {
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO matches (match_ref, ct, match_id, name, venue, date, level, region, sub_rule, discipline, status, results_status, scoring_completed, competitors_count, stages_count, lat, lng, data, updated_at, registration_starts, registration_closes, registration_status, squadding_starts, squadding_closes, is_registration_possible, is_squadding_possible, max_competitors, organizer_id, organizer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                       updated_at = excluded.updated_at,
                       registration_starts = excluded.registration_starts,
                       registration_closes = excluded.registration_closes,
                       registration_status = excluded.registration_status,
                       squadding_starts = excluded.squadding_starts,
                       squadding_closes = excluded.squadding_closes,
                       is_registration_possible = excluded.is_registration_possible,
                       is_squadding_possible = excluded.is_squadding_possible,
                       max_competitors = excluded.max_competitors,
                       organizer_id = excluded.organizer_id,
                       organizer_name = excluded.organizer_name`,
      )
      .bind(
        match.matchRef, match.ct, match.matchId, match.name,
        match.venue, match.date, match.level, match.region,
        match.subRule, match.discipline, match.status, match.resultsStatus,
        match.scoringCompleted, match.competitorsCount, match.stagesCount,
        match.lat, match.lng, match.data, match.updatedAt,
        match.registrationStarts, match.registrationCloses, match.registrationStatus,
        match.squaddingStarts, match.squaddingCloses,
        match.isRegistrationPossible ? 1 : 0, match.isSquaddingPossible ? 1 : 0,
        match.maxCompetitors,
        match.organizerId, match.organizerName,
      )
      .run();
  },

  async getMatchesByRefs(matchRefs) {
    if (matchRefs.length === 0) return new Map<string, MatchRecord>();
    const db = readDb();
    const placeholders = matchRefs.map(() => "?").join(",");
    type MatchRow = {
      match_ref: string; ct: number; match_id: string; name: string;
      venue: string | null; date: string | null; level: string | null;
      region: string | null; sub_rule: string | null; discipline: string | null;
      status: string | null; results_status: string | null;
      scoring_completed: number; competitors_count: number | null;
      stages_count: number | null; lat: number | null; lng: number | null;
      data: string | null; updated_at: string;
      registration_starts: string | null; registration_closes: string | null;
      registration_status: string | null;
      squadding_starts: string | null; squadding_closes: string | null;
      is_registration_possible: number | null; is_squadding_possible: number | null;
      max_competitors: number | null;
      organizer_id: string | null; organizer_name: string | null;
    };
    const result = await db
      .prepare(
        `SELECT match_ref, ct, match_id, name, venue, date, level, region, sub_rule, discipline,
                status, results_status, scoring_completed, competitors_count, stages_count,
                lat, lng, data, updated_at,
                registration_starts, registration_closes, registration_status,
                squadding_starts, squadding_closes,
                is_registration_possible, is_squadding_possible, max_competitors,
                organizer_id, organizer_name
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
        registrationStarts: r.registration_starts, registrationCloses: r.registration_closes,
        registrationStatus: r.registration_status,
        squaddingStarts: r.squadding_starts, squaddingCloses: r.squadding_closes,
        isRegistrationPossible: !!(r.is_registration_possible),
        isSquaddingPossible: !!(r.is_squadding_possible),
        maxCompetitors: r.max_competitors,
        organizerId: r.organizer_id,
        organizerName: r.organizer_name,
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

  async unsuppressShooter(shooterId) {
    const db = getDb();
    await db
      .prepare(`DELETE FROM shooter_suppressions WHERE shooter_id = ?`)
      .bind(shooterId)
      .run();
  },

  async listSuppressedShooters() {
    const db = getDb();
    const result = await db
      .prepare(`SELECT shooter_id, suppressed_at FROM shooter_suppressions ORDER BY suppressed_at DESC`)
      .all<{ shooter_id: number; suppressed_at: string }>();
    return result.results.map((r) => ({ shooterId: r.shooter_id, suppressedAt: r.suppressed_at }));
  },

  // ── Retention ──────────────────────────────────────────────────────────

  async purgeInactiveShooters(olderThan) {
    const db = getDb();
    const result = await db
      .prepare(
        `SELECT shooter_id FROM shooter_profiles
         WHERE last_seen < ?
           AND shooter_id NOT IN (SELECT shooter_id FROM shooter_suppressions)`,
      )
      .bind(olderThan)
      .all<{ shooter_id: number }>();

    const ids = result.results.map((r) => r.shooter_id);
    if (ids.length === 0) return 0;

    const stmts = ids.flatMap((id) => [
      db.prepare(`DELETE FROM shooter_profiles WHERE shooter_id = ?`).bind(id),
      db.prepare(`DELETE FROM shooter_matches WHERE shooter_id = ?`).bind(id),
      db.prepare(`DELETE FROM shooter_achievements WHERE shooter_id = ?`).bind(id),
    ]);
    await db.batch(stmts);
    return ids.length;
  },

  // ── Service account access catalog ───────────────────────────────────────

  async upsertServiceAccountAccess(row, now) {
    const roleNamesJson = JSON.stringify(row.roleNames ?? []);
    const isValid = row.isMembershipValid == null ? null : row.isMembershipValid ? 1 : 0;
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO service_account_access (
           kind, ssi_id, ssi_content_type, name, short_name, org_type, discipline,
           role_names, member_type, member_status, member_start_date, member_end_date,
           is_membership_valid, match_visibility, match_starts,
           first_seen_at, last_verified_at, revoked_at, revoked_reason
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(kind, ssi_id, COALESCE(ssi_content_type, -1))
         DO UPDATE SET
           name = excluded.name,
           short_name = excluded.short_name,
           org_type = excluded.org_type,
           discipline = excluded.discipline,
           role_names = excluded.role_names,
           member_type = excluded.member_type,
           member_status = excluded.member_status,
           member_start_date = excluded.member_start_date,
           member_end_date = excluded.member_end_date,
           is_membership_valid = excluded.is_membership_valid,
           match_visibility = excluded.match_visibility,
           match_starts = excluded.match_starts,
           last_verified_at = excluded.last_verified_at,
           revoked_at = NULL,
           revoked_reason = NULL`,
      )
      .bind(
        row.kind, row.ssiId, row.ssiContentType, row.name, row.shortName, row.orgType, row.discipline,
        roleNamesJson, row.memberType, row.memberStatus, row.memberStartDate, row.memberEndDate,
        isValid, row.matchVisibility, row.matchStarts,
        now, now,
      )
      .run();
  },

  async markStaleServiceAccountAccessRevoked(cutoff, reason, revokedAt) {
    const db = getDb();
    const result = await db
      .prepare(
        `UPDATE service_account_access
            SET revoked_at = ?, revoked_reason = ?
            WHERE last_verified_at < ? AND revoked_at IS NULL`,
      )
      .bind(revokedAt, reason, cutoff)
      .run();
    // D1 reports affected row count via meta.changes
    const meta = (result as { meta?: { changes?: number } }).meta;
    return meta?.changes ?? 0;
  },

  async listServiceAccountAccess(options) {
    const includeRevoked = options?.includeRevoked ?? true;
    const kindFilter = options?.kind;
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (!includeRevoked) conditions.push("revoked_at IS NULL");
    if (kindFilter) {
      conditions.push("kind = ?");
      params.push(kindFilter);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const db = getDb();
    type Row = {
      id: number; kind: string; ssi_id: string; ssi_content_type: number | null;
      name: string; short_name: string | null; org_type: string | null; discipline: string | null;
      role_names: string | null; member_type: string | null; member_status: string | null;
      member_start_date: string | null; member_end_date: string | null;
      is_membership_valid: number | null; match_visibility: string | null;
      match_starts: string | null; first_seen_at: string; last_verified_at: string;
      revoked_at: string | null; revoked_reason: string | null;
    };
    const result = await db
      .prepare(
        `SELECT id, kind, ssi_id, ssi_content_type, name, short_name, org_type, discipline,
                role_names, member_type, member_status, member_start_date, member_end_date,
                is_membership_valid, match_visibility, match_starts,
                first_seen_at, last_verified_at, revoked_at, revoked_reason
         FROM service_account_access
         ${where}
         ORDER BY revoked_at IS NULL DESC, last_verified_at DESC`,
      )
      .bind(...params)
      .all<Row>();
    return result.results.map((r) => decodeServiceAccountAccessRow(r));
  },
};

function decodeServiceAccountAccessRow(r: {
  id: number;
  kind: string;
  ssi_id: string;
  ssi_content_type: number | null;
  name: string;
  short_name: string | null;
  org_type: string | null;
  discipline: string | null;
  role_names: string | null;
  member_type: string | null;
  member_status: string | null;
  member_start_date: string | null;
  member_end_date: string | null;
  is_membership_valid: number | null;
  match_visibility: string | null;
  match_starts: string | null;
  first_seen_at: string;
  last_verified_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}): ServiceAccountAccessRow {
  let roleNames: string[] = [];
  if (r.role_names) {
    try {
      const parsed: unknown = JSON.parse(r.role_names);
      if (Array.isArray(parsed)) roleNames = parsed.filter((v): v is string => typeof v === "string");
    } catch { /* malformed JSON — treat as empty */ }
  }
  return {
    id: r.id,
    kind: r.kind as ServiceAccountAccessRow["kind"],
    ssiId: r.ssi_id,
    ssiContentType: r.ssi_content_type,
    name: r.name,
    shortName: r.short_name,
    orgType: r.org_type,
    discipline: r.discipline,
    roleNames,
    memberType: r.member_type,
    memberStatus: r.member_status,
    memberStartDate: r.member_start_date,
    memberEndDate: r.member_end_date,
    isMembershipValid: r.is_membership_valid == null ? null : !!r.is_membership_valid,
    matchVisibility: r.match_visibility,
    matchStarts: r.match_starts,
    firstSeenAt: r.first_seen_at,
    lastVerifiedAt: r.last_verified_at,
    revokedAt: r.revoked_at,
    revokedReason: r.revoked_reason,
  };
}

export default db;
