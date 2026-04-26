// Server-only — never import from client components or files with "use client".
// SSI_API_KEY lives here and must never be sent to the browser.

import { headers } from "next/headers";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { afterResponse } from "@/lib/background-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { parseMatchCacheKey } from "@/lib/match-data-store";

/**
 * Check if the current request is an admin-authenticated request
 * (Authorization: Bearer <CACHE_PURGE_SECRET>). Used to skip popularity
 * tracking (recordMatchAccess) during cache warming.
 */
async function isAdminRequest(): Promise<boolean> {
  try {
    const h = await headers();
    const secret = process.env.CACHE_PURGE_SECRET;
    return !!secret && h.get("authorization") === `Bearer ${secret}`;
  } catch {
    return false; // Not in a request context (e.g. build time)
  }
}

const GRAPHQL_ENDPOINT = "https://shootnscoreit.com/graphql/";

interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

/** Timeout for upstream GraphQL requests (ms). The SSI API can be slow
 *  for large matches with many scorecards, so we allow a generous window. */
const GRAPHQL_TIMEOUT_MS = 60_000;

export async function executeQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  revalidate: number | false = false,
): Promise<T> {
  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) throw new Error("SSI_API_KEY is not configured");

  // Extract the operation name for log context, e.g. "GetMatchScorecards"
  const operationName = query.match(/query\s+(\w+)/)?.[1] ?? "unknown";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAPHQL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
      cache: revalidate === false ? "no-store" : undefined,
      next: revalidate !== false ? { revalidate } : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error(`[ssi-api] ${operationName} timed out after ${GRAPHQL_TIMEOUT_MS}ms | vars=${JSON.stringify(variables ?? {})}`);
      throw new Error(`Upstream request timed out after ${GRAPHQL_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    let body = "";
    try { body = (await response.text()).slice(0, 300); } catch { /* ignore */ }

    const parts = [
      `[ssi-api] ${operationName} failed`,
      `HTTP ${response.status} ${response.statusText}`,
      `vars=${JSON.stringify(variables ?? {})}`,
      retryAfter ? `Retry-After=${retryAfter}` : null,
      body ? `body=${body}` : null,
    ].filter(Boolean);
    console.error(parts.join(" | "));

    const clientMsg = retryAfter
      ? `Upstream HTTP ${response.status}: ${response.statusText} (Retry-After: ${retryAfter}s)`
      : `Upstream HTTP ${response.status}: ${response.statusText}`;
    throw new Error(clientMsg);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ");
    console.error(`[ssi-api] ${operationName} GraphQL error | vars=${JSON.stringify(variables ?? {})} | ${msg}`);
    throw new Error(msg);
  }

  if (!result.data) {
    console.error(`[ssi-api] ${operationName} empty response | vars=${JSON.stringify(variables ?? {})}`);
    throw new Error("Empty response from upstream API");
  }

  return result.data;
}

// ─── Query: match overview ───────────────────────────────────────────────────
// `venue` and `scoring_completed` are on EventInterface (top level).
// `sub_rule`, `level`, `region`, `stages_count`, `competitors_count`, and
// the nested lists require `... on IpscMatchNode`.
//
// `scoring_completed` is returned as a decimal string (e.g. "56.31067961165048"),
// not a number. Parse with parseFloat() in the route handler.
//
// `competitor(content_type, id)` at the top level returns 404 in practice.
// All competitor/scorecard data is fetched via the event node.
//
// Multi-discipline note: all IPSC disciplines (Handgun, Rifle, Shotgun, PCC,
// Mini Rifle, Precision Rifle, Air) share the same ct=22, IpscMatchNode, and
// IpscCompetitorNode types. `get_division_display` is the universal division
// field that returns the correct value for any discipline. Discipline-specific
// raw fields (handgun_div, rifle_div, etc.) are also available on the same
// node — `get_division_display` is preferred and the others are kept only for
// backward compatibility with entries cached before schema v8.
export const MATCH_QUERY = `
  query GetMatch($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      id
      get_content_type_key
      name
      venue
      starts
      status
      results
      scoring_completed
      ... on IpscMatchNode {
        region
        sub_rule
        get_full_rule_display
        level
        stages_count
        competitors_count
        has_geopos
        lat
        lng
        ends
        registration_starts
        registration_closes
        squadding_starts
        squadding_closes
        is_registration_possible
        is_squadding_possible
        max_competitors
        registration
        image {
          url
          width
          height
        }
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
            minimum_rounds
            paper
            popper
            plate
            get_full_absolute_url
            course
            get_course_display
            procedure
            firearm_condition
          }
        }
        competitors_approved_w_wo_results_not_dnf {
          id
          get_content_type_key
          ... on IpscCompetitorNode {
            first_name
            last_name
            number
            club
            get_division_display
            handgun_div
            get_handgun_div_display
            shoots_handgun_major
            region
            get_region_display
            category
            ics_alias
            license
            shooter {
              id
            }
          }
        }
        squads {
          id
          ... on IpscSquadNode {
            number
            get_squad_display
            competitors {
              id
            }
          }
        }
      }
    }
  }
`;

/// ─── Query: list IPSC events ──────────────────────────────────────────────────
// Returns all publicly-visible IPSC matches filtered by optional free-text
// search, date range, and firearms type.
// Results include both IpscMatchNode (ct=22) and IpscSerieNode (ct=43) —
// filter to ct=22 in the route handler (all IPSC disciplines share ct=22).
// `region` is an ISO 3166-1 alpha-3 country code (e.g. "SWE", "NOR", "DNK",
// "FIN"). Country filtering is done server-side in the route handler after
// the GraphQL response is received — the SSI API has no region filter param.
export const EVENTS_QUERY = `
  query GetEvents($search: String, $starts_after: String, $starts_before: String, $firearms: String) {
    events(rule: "ip", firearms: $firearms, search: $search, starts_after: $starts_after, starts_before: $starts_before) {
      id
      get_content_type_key
      name
      venue
      starts
      ends
      status
      region
      get_full_rule_display
      get_full_level_display
      ... on IpscMatchNode {
        registration_starts
        registration_closes
        squadding_starts
        squadding_closes
        is_registration_possible
        is_squadding_possible
        max_competitors
        registration
      }
    }
  }
`;

// ─── Query: lightweight upcoming match status ────────────────────────────────
// Minimal query for upcoming matches — only fetches competitor IDs and squad
// assignments to determine registration/squadding status. ~5-10% of the data
// volume of GetMatch (no names, stages, scorecards, divisions, etc.).
export const UPCOMING_STATUS_QUERY = `
  query GetUpcomingStatus($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      ... on IpscMatchNode {
        is_registration_possible
        is_squadding_possible
        registration_starts
        registration_closes
        squadding_starts
        squadding_closes
        competitors_approved_w_wo_results_not_dnf {
          id
          ... on IpscCompetitorNode {
            shooter {
              id
            }
          }
        }
        squads {
          ... on IpscSquadNode {
            competitors {
              id
            }
          }
        }
      }
    }
  }
`;

// ─── Redis cache helpers ──────────────────────────────────────────────────────

export function gqlCacheKey(
  operationName: string,
  variables: Record<string, unknown>,
): string {
  return `gql:${operationName}:${JSON.stringify(variables)}`;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: string; // ISO timestamp
  v?: number;       // CACHE_SCHEMA_VERSION — absent on legacy entries (treated as v1)
}

/**
 * Single-flight background refresh of a cached GraphQL query. Acquires a
 * short-lived NX lock so concurrent stale readers trigger at most one upstream
 * fetch per cache key. Errors are swallowed — the cached value continues to be
 * served to users while the next request will try the refresh again.
 *
 * Use from a caller that has just served a stale cache hit (typically
 * cachedAt + freshness window exceeded). The caller decides the TTL because
 * TTL often depends on the response payload (e.g. match scoring %).
 */
export async function refreshCachedQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
  // Lock TTL must outlast the upstream GraphQL request so a slow fetch can't
  // expire its own lock and let a second refresh sneak in. GRAPHQL_TIMEOUT_MS
  // is 60s, so allow generous slack on top of that.
  lockTtlSeconds = 90,
): Promise<void> {
  const lockKey = `inflight:${cacheKey}`;
  let acquired = false;
  try {
    acquired = await cache.setIfAbsent(lockKey, "1", lockTtlSeconds);
  } catch {
    return; // Lock primitive failed — skip rather than hammer the API.
  }
  if (!acquired) return;

  try {
    const data = await executeQuery<T>(query, variables);
    const entry: CacheEntry<T> = {
      data,
      cachedAt: new Date().toISOString(),
      v: CACHE_SCHEMA_VERSION,
    };
    await cache.set(cacheKey, JSON.stringify(entry), ttlSeconds);
  } catch (err) {
    console.error("[cache] background refresh failed for key:", cacheKey, err);
  } finally {
    try {
      await cache.del(lockKey);
    } catch { /* lock will expire via TTL */ }
  }
}

/**
 * Returns cached data + cachedAt timestamp, or fetches fresh and stores it.
 * ttlSeconds = null → no expiry (permanent cache).
 * Falls back to a direct fetch on Redis error.
 *
 * Return value:
 *   cachedAt — ISO string when the data was first stored (cache hit)
 *              null when the data was just fetched (cache miss — not yet stored)
 *
 * Callers that want stale-while-revalidate should compare `cachedAt` against
 * a freshness window and schedule `refreshCachedQuery()` when exceeded.
 */
export async function cachedExecuteQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
): Promise<{ data: T; cachedAt: string | null }> {
  try {
    const raw = await cache.get(cacheKey);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      // Schema version gate: entries without a version or with an older version
      // are treated as misses. They will be overwritten on the next fetch.
      if (entry.v === CACHE_SCHEMA_VERSION) {
        if (cacheKey.startsWith("gql:GetMatch:") && !(await isAdminRequest())) {
          afterResponse(db.recordMatchAccess(cacheKey).catch(() => {}));
        }
        return { data: entry.data, cachedAt: entry.cachedAt };
      }
    }
  } catch (err) {
    console.error("[cache] read error for key:", cacheKey, err);
  }

  // D1/SQLite fallback — check durable store before hitting GraphQL.
  // Only for match-related keys (GetMatch, GetMatchScorecards, matchglobal).
  if (parseMatchCacheKey(cacheKey)) {
    try {
      const d1Raw = await db.getMatchDataCache(cacheKey);
      if (d1Raw) {
        const entry = JSON.parse(d1Raw) as CacheEntry<T>;
        if (entry.v === CACHE_SCHEMA_VERSION) {
          if (cacheKey.startsWith("gql:GetMatch:") && !(await isAdminRequest())) {
            afterResponse(db.recordMatchAccess(cacheKey).catch(() => {}));
          }
          return { data: entry.data, cachedAt: entry.cachedAt };
        }
      }
    } catch (err) {
      console.error("[cache] D1 fallback error for key:", cacheKey, err);
    }
  }

  const data = await executeQuery<T>(query, variables);
  const cachedAt = new Date().toISOString();

  try {
    const entry: CacheEntry<T> = { data, cachedAt, v: CACHE_SCHEMA_VERSION };
    const payload = JSON.stringify(entry);
    await cache.set(cacheKey, payload, ttlSeconds);
  } catch (err) {
    console.error("[cache] write error for key:", cacheKey, err);
  }

  // Record access for popularity tracking (fire-and-forget, non-fatal).
  if (cacheKey.startsWith("gql:GetMatch:") && !(await isAdminRequest())) {
    void db.recordMatchAccess(cacheKey).catch(() => {});
  }

  // Return null for cachedAt: freshly fetched, not served from cache
  return { data, cachedAt: null };
}

// ─── Query: all stage scorecards for a match ─────────────────────────────────
// Returns raw scorecard data for every competitor on every stage.
// `get_results` (official placement) is blocked during active matches — this
// query uses the raw scorecards path which is always accessible.
// Filter the response to the desired competitor IDs server-side.
export const SCORECARDS_QUERY = `
  query GetMatchScorecards($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      ... on IpscMatchNode {
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
          }
          scorecards {
            ... on IpscScoreCardNode {
              created
              points
              hitfactor
              time
              disqualified
              zeroed
              stage_not_fired
              incomplete
              ascore
              bscore
              cscore
              dscore
              miss
              penalty
              procedural
              competitor {
                id
                ... on IpscCompetitorNode {
                  first_name
                  last_name
                  number
                  club
                  get_division_display
                  handgun_div
                  get_handgun_div_display
                  region
                  get_region_display
                  category
                  ics_alias
                  license
                }
              }
            }
          }
        }
      }
    }
  }
`;
