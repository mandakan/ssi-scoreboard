// Server-only — local-first event text search (#505, query-cuts epic #510).
//
// Searches the D1/SQLite `matches` domain table by name/venue, then hydrates
// each hit from the cached GetMatch blob (Redis -> D1, zero upstream). Only
// hits that hydrate into a COMPLETE, public event are returned; anything
// missing or non-public is dropped, and an empty result tells the events
// route to fall through to the upstream GetEvents search unchanged.

import db from "@/lib/db-impl";
import { gqlCacheKey } from "@/lib/graphql";
import { getMatchDataWithFallback } from "@/lib/match-data-store";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { classifyVisibility } from "@/lib/visibility";

/** Raw event shape consumed by the events route pipeline (structural subset
 *  of its RawEvent). All fields required by the mapper are present or the
 *  hit is dropped. */
export interface LocalRawEvent {
  id: string;
  get_content_type_key: number;
  name: string;
  venue: string | null;
  starts: string;
  ends: string | null;
  status: string;
  region: string;
  get_full_rule_display: string;
  get_full_level_display: string;
  registration_starts: string | null;
  registration_closes: string | null;
  squadding_starts: string | null;
  squadding_closes: string | null;
  is_registration_possible: boolean;
  is_squadding_possible: boolean;
  max_competitors: number | null;
  registration: string;
  visibility?: string;
  get_visibility_display?: string;
}

interface CachedMatchEvent {
  name?: string | null;
  venue?: string | null;
  starts?: string | null;
  ends?: string | null;
  status?: string | null;
  region?: string | null;
  level?: number | string | null;
  get_full_rule_display?: string | null;
  visibility?: string | null;
  get_visibility_display?: string | null;
  registration?: string | null;
  registration_starts?: string | null;
  registration_closes?: string | null;
  squadding_starts?: string | null;
  squadding_closes?: string | null;
  is_registration_possible?: boolean | null;
  is_squadding_possible?: boolean | null;
  max_competitors?: number | null;
}

const LEVEL_DISPLAY: Record<string, string> = {
  "1": "Level I",
  "2": "Level II",
  "3": "Level III",
  "4": "Level IV",
  "5": "Level V",
};

/**
 * Map a cached GetMatch event to the events-route raw shape. Returns null
 * unless the event is complete AND publicly visible — never serve partial
 * shapes or surface non-public matches from local search.
 */
export function cachedMatchEventToRawEvent(
  ct: number,
  matchId: string,
  ev: CachedMatchEvent,
): LocalRawEvent | null {
  if (!ev.name || !ev.starts || !ev.status || !ev.region) return null;
  if (!ev.visibility || classifyVisibility(ev.visibility) !== "public") return null;
  const levelDisplay = ev.level != null ? LEVEL_DISPLAY[String(ev.level)] : undefined;
  if (!levelDisplay || !ev.get_full_rule_display) return null;
  return {
    id: matchId,
    get_content_type_key: ct,
    name: ev.name,
    venue: ev.venue ?? null,
    starts: ev.starts,
    ends: ev.ends ?? null,
    status: ev.status,
    region: ev.region,
    get_full_rule_display: ev.get_full_rule_display,
    get_full_level_display: levelDisplay,
    registration_starts: ev.registration_starts ?? null,
    registration_closes: ev.registration_closes ?? null,
    squadding_starts: ev.squadding_starts ?? null,
    squadding_closes: ev.squadding_closes ?? null,
    is_registration_possible: ev.is_registration_possible ?? false,
    is_squadding_possible: ev.is_squadding_possible ?? false,
    max_competitors: ev.max_competitors ?? null,
    registration: ev.registration ?? "cl",
    visibility: ev.visibility,
    get_visibility_display: ev.get_visibility_display ?? "",
  };
}

/** Read + version-gate a cached GetMatch entry (Redis -> D1, no upstream). */
export async function readCachedMatchEvent(
  ct: number,
  matchId: string,
): Promise<CachedMatchEvent | null> {
  try {
    const raw = await getMatchDataWithFallback(gqlCacheKey("GetMatch", { ct, id: matchId }));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { data?: { event?: CachedMatchEvent | null }; v?: number };
    if (entry.v !== CACHE_SCHEMA_VERSION) return null;
    return entry.data?.event ?? null;
  } catch {
    return null;
  }
}

/** Local-first search: name/venue substring over the matches table, hydrated
 *  from the match cache. Empty array = caller should hit upstream. */
export async function searchLocalEvents(query: string, limit = 20): Promise<LocalRawEvent[]> {
  try {
    const refs = await db.searchMatches(query, limit);
    if (refs.length === 0) return [];
    const hydrated = await Promise.all(
      refs.map(async (r) => {
        const ev = await readCachedMatchEvent(r.ct, r.matchId);
        return ev ? cachedMatchEventToRawEvent(r.ct, r.matchId, ev) : null;
      }),
    );
    return hydrated.filter((e): e is LocalRawEvent => e !== null);
  } catch {
    return []; // any local trouble -> upstream fallback
  }
}
