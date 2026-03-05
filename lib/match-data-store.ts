// Server-only — never import from client components or files with "use client".
// Shared helpers for the tiered match data store: Redis → D1/SQLite → GraphQL.
//
// getMatchDataWithFallback() — read from Redis, fall back to D1.
// persistToMatchStore()      — write to D1, set Redis TTL to 24h (drain).

import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

/** 24 hours — Redis drain TTL for completed matches written to D1. */
const REDIS_DRAIN_TTL = 86_400;

interface CacheEntryMeta {
  v?: number;
}

/**
 * Read match data from Redis, falling back to D1/SQLite if not in Redis.
 * Returns the raw JSON string or null if not found in either layer.
 * Only returns D1 data if its schema_version matches the current version.
 */
export async function getMatchDataWithFallback(
  cacheKey: string,
): Promise<string | null> {
  // Try Redis first
  try {
    const raw = await cache.get(cacheKey);
    if (raw) return raw;
  } catch { /* ignore Redis errors */ }

  // Fall back to D1/SQLite
  try {
    const raw = await db.getMatchDataCache(cacheKey);
    if (raw) {
      // Validate schema version before returning
      const meta = JSON.parse(raw) as CacheEntryMeta;
      if (meta.v === CACHE_SCHEMA_VERSION) {
        return raw;
      }
    }
  } catch { /* ignore DB errors */ }

  return null;
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
  } catch { /* ignore — Redis key may already be gone */ }
}
