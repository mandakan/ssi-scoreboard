// Server-only — read-only match data access for the OG/link-preview path
// (#506, query-cuts epic #510). Bots and link unfurlers must NEVER trigger
// upstream GraphQL fetches or cache writes: Redis -> D1 -> null, and a null
// simply renders the generic OG card. This also removes the old permanent
// (ttl=null) scorecards write the OG route used to make.

import { gqlCacheKey } from "@/lib/graphql";
import { getMatchDataWithFallback } from "@/lib/match-data-store";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

async function readEntry<T>(cacheKey: string): Promise<T | null> {
  try {
    const raw = await getMatchDataWithFallback(cacheKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data?: T; v?: number };
    if (entry.v !== CACHE_SCHEMA_VERSION || !entry.data) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/** Cached GetMatch blob (typed by the caller's raw shape), or null. */
export async function readCachedRawMatchData<T = { event: unknown }>(
  ct: number,
  matchId: string,
): Promise<T | null> {
  return readEntry<T>(gqlCacheKey("GetMatch", { ct, id: matchId }));
}

/** Cached GetMatchScorecards snapshot, or null. */
export async function readCachedScorecardsData<T = { event: unknown }>(
  ct: number,
  matchId: string,
): Promise<T | null> {
  return readEntry<T>(gqlCacheKey("GetMatchScorecards", { ct, id: matchId }));
}
