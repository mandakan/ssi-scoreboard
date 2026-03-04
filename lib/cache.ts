// Cache adapter interface — server-only.
// Two implementations:
//   lib/cache-node.ts  — ioredis (Node.js / Docker)
//   lib/cache-edge.ts  — @upstash/redis (Cloudflare edge)
// lib/cache-impl.ts re-exports the node adapter by default; the CF build
// overrides it via a webpack alias in next.config.ts.

export interface CacheAdapter {
  get(key: string): Promise<string | null>;
  /** ttlSeconds = null/undefined → no expiry (permanent). */
  set(key: string, value: string, ttlSeconds?: number | null): Promise<void>;
  /** Remove TTL from an existing key, making it permanent. */
  persist(key: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Set a TTL on an existing key (seconds). No-op if the key does not exist. */
  expire(key: string, ttlSeconds: number): Promise<void>;
  /**
   * Record that a match cache key was accessed.
   *
   * Updates two sorted sets:
   *   popular:matches:seen  — score = current Unix timestamp (last-seen)
   *   popular:matches:hits  — score incremented by 1 on every access (hit count)
   *
   * Implementations should be fire-and-forget safe (errors silently ignored).
   */
  recordMatchAccess(key: string): Promise<void>;
  /**
   * Return the most-accessed match cache keys that have been seen within
   * the last maxAgeSeconds, sorted by hit count descending.
   *
   * Prunes the seen set on each call to prevent unbounded growth.
   * Returns [] on any error.
   */
  getPopularKeys(
    maxAgeSeconds: number,
    limit: number,
  ): Promise<{ key: string; hits: number }[]>;

  // ── Shooter cross-match index ─────────────────────────────────────────────

  /**
   * Add a match reference to a shooter's match sorted set.
   *
   * Key: shooter:{shooterId}:matches
   * Member: "{ct}:{matchId}" (e.g. "22:26547")
   * Score: match start Unix timestamp (seconds)
   *
   * No TTL — the index is permanent. Fire-and-forget safe.
   */
  indexShooterMatch(
    shooterId: number,
    matchRef: string,
    startTimestamp: number,
  ): Promise<void>;

  /**
   * Persist a JSON-serialised ShooterProfile for quick display (name, club, division).
   * Overwrites on each call so the profile always reflects the latest match data.
   * Key: shooter:{shooterId}:profile  — no TTL (permanent).
   */
  setShooterProfile(shooterId: number, profile: string): Promise<void>;

  /**
   * Return all match refs for a shooter, sorted by match date ascending.
   * Returns [] if no entries exist or on error.
   */
  getShooterMatches(shooterId: number): Promise<string[]>;

  /** Return the raw JSON profile string, or null if not found. */
  getShooterProfile(shooterId: number): Promise<string | null>;

  /**
   * Scan for all cached GetMatch keys using Redis SCAN (cursor-based, non-blocking).
   * Returns bare cache keys (without CACHE_KEY_PREFIX) matching `gql:GetMatch:*`.
   */
  scanCachedMatchKeys(): Promise<string[]>;
}
