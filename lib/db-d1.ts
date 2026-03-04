// Server-only — D1-backed AppDatabase (Cloudflare Pages target).
// Never import from client components or files with "use client".
// Never import ioredis, better-sqlite3, or any Node.js-only module from this file.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AppDatabase } from "@/lib/db";
import { MAX_SHOOTER_MATCHES } from "@/lib/constants";

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

// Schema is managed by migrations/0001_init.sql applied via:
//   wrangler d1 migrations apply APP_DB [--env staging]
// No runtime schema init needed here.
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

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS cnt FROM shooter_matches WHERE shooter_id = ?`)
      .bind(shooterId)
      .first<{ cnt: number }>();

    const count = countRow?.cnt ?? 0;
    if (count > MAX_SHOOTER_MATCHES) {
      await db
        .prepare(
          `DELETE FROM shooter_matches
           WHERE shooter_id = ? AND match_ref IN (
             SELECT match_ref FROM shooter_matches
             WHERE shooter_id = ?
             ORDER BY start_timestamp ASC
             LIMIT ?
           )`,
        )
        .bind(shooterId, shooterId, count - MAX_SHOOTER_MATCHES)
        .run();
    }
  },

  async setShooterProfile(shooterId, profile) {
    const db = getDb();
    await db
      .prepare(
        `INSERT INTO shooter_profiles (shooter_id, name, club, division, last_seen)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(shooter_id)
         DO UPDATE SET name = excluded.name,
                       club = excluded.club,
                       division = excluded.division,
                       last_seen = excluded.last_seen`,
      )
      .bind(
        shooterId,
        profile.name,
        profile.club ?? null,
        profile.division ?? null,
        profile.lastSeen,
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

  async getShooterProfile(shooterId) {
    const db = getDb();
    const row = await db
      .prepare(
        `SELECT name, club, division, last_seen FROM shooter_profiles
         WHERE shooter_id = ?`,
      )
      .bind(shooterId)
      .first<{ name: string; club: string | null; division: string | null; last_seen: string }>();
    if (!row) return null;
    return {
      name: row.name,
      club: row.club,
      division: row.division,
      lastSeen: row.last_seen,
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
};

export default db;
