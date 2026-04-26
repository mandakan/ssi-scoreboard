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
   * Atomic set-if-absent. Returns true if the key was set, false if it already
   * existed. Used as a single-flight lock primitive (e.g. for SWR background
   * refresh dedup). Backed by Redis `SET NX EX`.
   */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Scan for all cached GetMatch keys using Redis SCAN (cursor-based, non-blocking).
   * Returns bare cache keys (without CACHE_KEY_PREFIX) matching `gql:GetMatch:*`.
   */
  scanCachedMatchKeys(): Promise<string[]>;
}
