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
import type { ShooterSearchResult } from "@/lib/types";

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
}
