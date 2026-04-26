// AppDatabase interface — persistent storage for app data (SQLite / Cloudflare D1).
// Two implementations:
//   lib/db-sqlite.ts  — better-sqlite3 (Node.js / Docker)
//   lib/db-d1.ts      — Cloudflare D1 (Cloudflare Pages)
// lib/db-impl.ts re-exports the SQLite adapter by default; the CF build overrides
// it via webpack/turbopack aliases in next.config.ts.
//
// Add new persistent domain data here by extending this interface and adding
// the corresponding tables to the SQL schema in db-sqlite.ts / db-d1.ts.

import type { ShooterProfile } from "@/lib/shooter-index";
import type { StoredAchievement } from "@/lib/achievements/types";
import type { MatchRecord, ShooterSearchResult } from "@/lib/types";

export interface AppDatabase {
  // ── Shooter cross-match index ────────────────────────────────────────────

  /** Add a match reference to a shooter's match index. Idempotent upsert. */
  indexShooterMatch(
    shooterId: number,
    matchRef: string,
    startTimestamp: number,
  ): Promise<void>;

  /** Persist a shooter profile (name, club, division, lastSeen). */
  setShooterProfile(
    shooterId: number,
    profile: ShooterProfile,
  ): Promise<void>;

  /** Return all match refs for a shooter, sorted by match date ascending. */
  getShooterMatches(shooterId: number): Promise<string[]>;

  /** Return match refs where start_timestamp > now(), sorted ascending. */
  getUpcomingMatches(shooterId: number): Promise<string[]>;

  /** Return the shooter profile, or null if not found. */
  getShooterProfile(shooterId: number): Promise<ShooterProfile | null>;

  /** Check whether a shooter profile exists. */
  hasShooterProfile(shooterId: number): Promise<boolean>;

  /**
   * Search shooter profiles by name (case-insensitive substring match).
   * An empty query returns the most recently seen shooters.
   * Results are sorted by last_seen descending. Limit defaults to 20, max 100.
   */
  searchShooterProfiles(
    query: string,
    options?: { limit?: number },
  ): Promise<ShooterSearchResult[]>;

  // ── Match popularity tracking ────────────────────────────────────────────

  /** Record that a match cache key was accessed (for popularity tracking). */
  recordMatchAccess(key: string): Promise<void>;

  /**
   * Return the most-accessed match cache keys seen within the last
   * maxAgeSeconds, sorted by hit count descending.
   */
  getPopularKeys(
    maxAgeSeconds: number,
    limit: number,
  ): Promise<{ key: string; hits: number }[]>;

  // ── Achievements ───────────────────────────────────────────────────────

  /** Return all stored achievement tiers for a shooter. */
  getShooterAchievements(shooterId: number): Promise<StoredAchievement[]>;

  /** Persist newly unlocked achievement tiers. Idempotent (INSERT OR IGNORE). */
  saveShooterAchievements(
    shooterId: number,
    achievements: StoredAchievement[],
  ): Promise<void>;

  // ── Match data cache (historical match data offloaded from Redis) ────────

  /** Retrieve a cached match data entry by its cache key. Returns the raw JSON string or null. */
  getMatchDataCache(cacheKey: string): Promise<string | null>;

  /** Retrieve only the `stored_at` timestamp of a match data cache row.
   *  Used by throttled writers to skip redundant updates. */
  getMatchDataCacheStoredAt(cacheKey: string): Promise<string | null>;

  /** Store a match data entry. Upserts on cache_key. */
  setMatchDataCache(
    cacheKey: string,
    data: string,
    meta: {
      keyType: string;
      ct: number;
      matchId: string;
      schemaVersion: number;
    },
  ): Promise<void>;

  /** Delete one or more match data cache entries by cache key. */
  deleteMatchDataCache(...cacheKeys: string[]): Promise<void>;

  /** Return all cache keys in match_data_cache, optionally filtered by key_type. */
  scanMatchDataCacheKeys(keyType?: string): Promise<string[]>;

  /** List match_data_cache entries with metadata, optionally filtered by key_type and/or stored_at.
   *  Pass includeData: true to also return the raw JSON blob (avoids N+1 queries). */
  listMatchCacheEntries(options?: {
    keyType?: string;
    since?: string;
    includeData?: boolean;
  }): Promise<
    Array<{ cacheKey: string; keyType: string; ct: number; matchId: string; storedAt: string; data?: string }>
  >;

  // ── Matches domain index ─────────────────────────────────────────────────
  // Structured match-level metadata — populated opportunistically on every
  // match page visit or comparison. Provides durable match identity for the
  // shooter dashboard without requiring the full JSON blob from Redis/match_data_cache.

  /** Upsert match-level metadata. Idempotent on match_ref. */
  upsertMatch(match: MatchRecord): Promise<void>;

  /**
   * Return match metadata for the given match_refs.
   * Results are keyed by match_ref for O(1) lookup.
   * Missing refs are simply absent from the returned map.
   */
  getMatchesByRefs(matchRefs: string[]): Promise<Map<string, MatchRecord>>;

  // ── Shooter suppressions (GDPR) ──────────────────────────────────────

  /** Check whether a shooter ID is suppressed (GDPR erasure). */
  isShooterSuppressed(shooterId: number): Promise<boolean>;

  /** Return all suppressed shooter IDs. Used by indexMatchShooters to skip suppressed shooters in bulk. */
  getAllSuppressedShooterIds(): Promise<Set<number>>;

  /** Suppress a shooter: add to suppression list and delete profile, match index, and achievements. */
  suppressShooter(shooterId: number): Promise<void>;

  /** Remove a shooter from the suppression list, allowing re-indexing. */
  unsuppressShooter(shooterId: number): Promise<void>;

  /** Return all suppressed shooter IDs with their suppression timestamps. */
  listSuppressedShooters(): Promise<Array<{ shooterId: number; suppressedAt: string }>>;

  // ── Retention ───────────────────────────────────────────────────────────

  /**
   * Delete shooter profiles (and their match index + achievements) where
   * last_seen is older than the given ISO timestamp. Returns the number of
   * profiles purged. Does NOT purge suppressed shooters — those are kept
   * intentionally.
   */
  purgeInactiveShooters(olderThan: string): Promise<number>;
}
