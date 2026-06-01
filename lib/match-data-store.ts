// Server-only — never import from client components or files with "use client".
// Shared helpers for the tiered match data store: Redis → D1/SQLite → GraphQL.
//
// getMatchDataWithFallback() — read from Redis, fall back to D1.
// persistActiveMatchToD1()   — write to D1 only (no Redis touch), throttled.
//                              Used on every successful upstream fetch so D1
//                              has a recent "last known good" snapshot if Redis
//                              evicts during an upstream outage.
// persistToMatchStore()      — write to D1, set Redis TTL to 24h (drain).
//                              Used only when a match is definitively done.

import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { reportError } from "@/lib/error-telemetry";

/** 24 hours — Redis drain TTL for completed matches written to D1. */
const REDIS_DRAIN_TTL = 86_400;

/** Default minimum age (seconds) before re-writing an active-match D1 row. */
const ACTIVE_MATCH_D1_THROTTLE_SECONDS = 120;

/** Minimum interval (ms) between `last_accessed_at` bumps for the same cache
 *  key, debounced in-process. Keeps the audit signal coarsely accurate while
 *  bounding the D1 UPDATE rate on hot matches. Cold starts re-bump once,
 *  which is fine — the column tracks "recently served", not exact hit count. */
const TOUCH_DEBOUNCE_MS = 60_000;

/** In-memory per-cache-key last-touch timestamps. Process-local; not shared
 *  across CF Worker isolates or Docker replicas. Each isolate independently
 *  debounces — duplicate writes are harmless since touch is idempotent. */
const lastTouchedAt = new Map<string, number>();

/** Redis key prefix for the cross-isolate touch single-flight lock. */
const TOUCH_LOCK_PREFIX = "touchlock:";

/** Global (cross-isolate) debounce window for `last_accessed_at` bumps, in
 *  seconds. The per-process `lastTouchedAt` map only debounces within one
 *  Worker isolate; during a traffic burst Cloudflare spins up many fresh
 *  isolates that each fire their own UPDATE, which is what overloaded D1
 *  ("D1 DB is overloaded"). This Redis-backed single-flight bounds the touch
 *  to ~one UPDATE per cache key per window across ALL isolates. The window is
 *  deliberately generous: the only consumer of `last_accessed_at` is the admin
 *  "served in the last 30 days" diagnostic (app/admin/access), so hour-level
 *  freshness is plenty. */
const TOUCH_GLOBAL_DEBOUNCE_SECONDS = 3_600;

interface CacheEntryMeta {
  v?: number;
}

/**
 * Read match data from Redis, falling back to D1/SQLite if not in Redis.
 * Returns the raw JSON string or null if not found in either layer.
 * Only returns D1 data if its schema_version matches the current version.
 *
 * Side-effect: when we serve a cached entry (from either layer) the D1
 * row's `last_accessed_at` is bumped, debounced per-process to ~once per
 * minute per cache key. Errors on the bump are swallowed — the read path
 * must never fail because of an audit-bookkeeping write.
 */
export async function getMatchDataWithFallback(
  cacheKey: string,
): Promise<string | null> {
  let raw: string | null = null;

  // Try Redis first
  try {
    raw = await cache.get(cacheKey);
  } catch (err) {
    reportError("match-data-store.redis-read", err, { matchKey: cacheKey });
  }

  // Fall back to D1/SQLite — return whatever is stored; callers are responsible
  // for deciding whether a given schema version is acceptable for their use case.
  if (!raw) {
    try {
      raw = await db.getMatchDataCache(cacheKey);
    } catch (err) {
      reportError("match-data-store.d1-read", err, { matchKey: cacheKey });
    }
  }

  if (raw) maybeTouchMatchDataCache(cacheKey);
  return raw;
}

/** Bump `last_accessed_at` on the D1 row, debounced per cache key. */
function maybeTouchMatchDataCache(cacheKey: string): void {
  if (!parseMatchCacheKey(cacheKey)) return; // only match-tagged keys get audited
  const now = Date.now();
  const last = lastTouchedAt.get(cacheKey);
  if (last !== undefined && now - last < TOUCH_DEBOUNCE_MS) return;
  lastTouchedAt.set(cacheKey, now);
  // Fire-and-forget — never block the read path on the audit write. A
  // Redis-backed single-flight (SET NX EX) gates the D1 UPDATE so a traffic
  // burst's many cold isolates don't storm the primary with redundant touches:
  // only the first caller per key per window actually writes. A benign race
  // (two isolates both acquiring) is harmless since the UPDATE is idempotent.
  void (async () => {
    try {
      const acquired = await cache.setIfAbsent(
        `${TOUCH_LOCK_PREFIX}${cacheKey}`,
        "1",
        TOUCH_GLOBAL_DEBOUNCE_SECONDS,
      );
      if (!acquired) return; // another isolate touched this key recently
      await db.touchMatchDataCache(cacheKey, new Date(now).toISOString());
    } catch (err) {
      reportError("match-data-store.touch", err, { matchKey: cacheKey });
    }
  })();
}

/**
 * Parse a gql cache key to extract keyType, ct, and matchId.
 * Supports:
 *   gql:GetMatch:{"ct":22,"id":"26547"}
 *   gql:GetMatchScorecards:{"ct":22,"id":"26547"}
 *   computed:matchglobal:22:26547
 */
export function parseMatchCacheKey(
  cacheKey: string,
): { keyType: string; ct: number; matchId: string } | null {
  if (cacheKey.startsWith("gql:GetMatch:") && !cacheKey.startsWith("gql:GetMatchScorecards:")) {
    try {
      const vars = JSON.parse(cacheKey.slice("gql:GetMatch:".length)) as { ct?: number; id?: string };
      if (vars.ct != null && vars.id) {
        return { keyType: "match", ct: vars.ct, matchId: vars.id };
      }
    } catch { /* invalid key format */ }
    return null;
  }

  if (cacheKey.startsWith("gql:GetMatchScorecards:")) {
    try {
      const vars = JSON.parse(cacheKey.slice("gql:GetMatchScorecards:".length)) as { ct?: number; id?: string };
      if (vars.ct != null && vars.id) {
        return { keyType: "scorecards", ct: vars.ct, matchId: vars.id };
      }
    } catch { /* invalid key format */ }
    return null;
  }

  if (cacheKey.startsWith("computed:matchglobal:")) {
    const rest = cacheKey.slice("computed:matchglobal:".length);
    const colonIdx = rest.indexOf(":");
    if (colonIdx > 0) {
      const ct = parseInt(rest.slice(0, colonIdx), 10);
      const matchId = rest.slice(colonIdx + 1);
      if (!isNaN(ct) && matchId) {
        return { keyType: "matchglobal", ct, matchId };
      }
    }
    return null;
  }

  return null;
}

/**
 * Persist active-match data to D1/SQLite as a "last known good" fallback.
 * Does NOT touch Redis (TTL stays whatever the caller set), so SWR freshness
 * windows are preserved.
 *
 * Throttled: skips the write if the existing D1 row is younger than
 * `minAgeSeconds` (default 120s) to bound D1 write volume on hot paths.
 *
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function persistActiveMatchToD1(
  cacheKey: string,
  rawJson: string,
  minAgeSeconds: number = ACTIVE_MATCH_D1_THROTTLE_SECONDS,
): Promise<void> {
  const parsed = parseMatchCacheKey(cacheKey);
  if (!parsed) return;

  const { keyType, ct, matchId } = parsed;

  try {
    const storedAt = await db.getMatchDataCacheStoredAt(cacheKey);
    if (storedAt) {
      const ageMs = Date.now() - new Date(storedAt).getTime();
      if (ageMs < minAgeSeconds * 1000) return; // throttled — recent enough
    }
  } catch { /* if the read fails, fall through and try the write */ }

  let schemaVersion = CACHE_SCHEMA_VERSION;
  try {
    const meta = JSON.parse(rawJson) as CacheEntryMeta;
    if (meta.v != null) schemaVersion = meta.v;
  } catch { /* use default */ }

  try {
    await db.setMatchDataCache(cacheKey, rawJson, {
      keyType,
      ct,
      matchId,
      schemaVersion,
    });
  } catch (err) {
    console.error("[match-data-store] active D1 write error:", cacheKey, err);
  }
}

/**
 * Persist match data to D1/SQLite and set a 24h drain TTL on the Redis key.
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function persistToMatchStore(
  cacheKey: string,
  rawJson: string,
): Promise<void> {
  const parsed = parseMatchCacheKey(cacheKey);
  if (!parsed) return;

  const { keyType, ct, matchId } = parsed;

  // Determine schema version from the data
  let schemaVersion = CACHE_SCHEMA_VERSION;
  try {
    const meta = JSON.parse(rawJson) as CacheEntryMeta;
    if (meta.v != null) schemaVersion = meta.v;
  } catch { /* use default */ }

  try {
    await db.setMatchDataCache(cacheKey, rawJson, {
      keyType,
      ct,
      matchId,
      schemaVersion,
    });
  } catch (err) {
    console.error("[match-data-store] D1 write error:", cacheKey, err);
    return;
  }

  // Set Redis TTL to 24h so the key drains from Redis over time
  try {
    await cache.expire(cacheKey, REDIS_DRAIN_TTL);
  } catch (err) {
    reportError("match-data-store.redis-drain-ttl", err, { matchKey: cacheKey });
  }
}
