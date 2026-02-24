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
  /**
   * Scan for keys with the given prefix, filtered to those accessed within
   * maxIdleSeconds, sorted by most-recently-accessed first.
   * Returns [] on adapters that don't support idle-time inspection (edge).
   */
  scanRecentKeys(
    prefix: string,
    maxIdleSeconds: number,
  ): Promise<{ key: string; idleSeconds: number }[]>;
}
