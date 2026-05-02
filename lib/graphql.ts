// Server-only — never import from client components or files with "use client".
// SSI_API_KEY lives here and must never be sent to the browser.

import { headers } from "next/headers";
import cache from "@/lib/cache-impl";
import db from "@/lib/db-impl";
import { afterResponse } from "@/lib/background-impl";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";
import { parseMatchCacheKey, persistActiveMatchToD1 } from "@/lib/match-data-store";
import { markUpstreamDegraded } from "@/lib/upstream-status";
import { upstreamTelemetry, hashVariables, type UpstreamOutcome } from "@/lib/upstream-telemetry";
import { cacheTelemetry } from "@/lib/cache-telemetry";

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

/** Default timeout for upstream GraphQL requests (ms). The SSI API can be
 *  slow for large matches with many scorecards, so we allow a generous window
 *  by default. Callers that know their query is small (e.g. /api/events
 *  sub-windows) should pass a tighter timeout via the `timeoutMs` option. */
const GRAPHQL_TIMEOUT_MS = 60_000;

export interface ExecuteQueryOptions {
  /** Override the default 60s timeout for this call. Triggers AbortController
   *  on the underlying fetch, so the upstream request is genuinely cancelled
   *  rather than just abandoned. */
  timeoutMs?: number;
}

/** Error messages we treat as a transient upstream condition worth one retry.
 *  "Must provide document." is graphql-core's message when SSI's parser sees
 *  an empty query string — observed in production when SSI's gateway
 *  occasionally drops the POST body on a busy isolate. A second attempt with
 *  the same payload almost always succeeds. */
const RETRY_GRAPHQL_MESSAGES = [
  "Must provide document.",
];

export async function executeQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  revalidate: number | false = false,
  options: ExecuteQueryOptions = {},
): Promise<T> {
  try {
    return await executeQueryOnce<T>(query, variables, revalidate, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (RETRY_GRAPHQL_MESSAGES.some((m) => msg.includes(m))) {
      // Single immediate retry. We don't back off — the failure mode is a
      // dropped body at SSI's gateway, not load shedding, so a retry helps
      // most when it goes out right behind the failed request.
      return await executeQueryOnce<T>(query, variables, revalidate, options);
    }
    throw err;
  }
}

async function executeQueryOnce<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  revalidate: number | false,
  options: ExecuteQueryOptions,
): Promise<T> {
  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) throw new Error("SSI_API_KEY is not configured");

  // Extract the operation name for log context, e.g. "GetMatchScorecards"
  const operationName = query.match(/query\s+(\w+)/)?.[1] ?? "unknown";
  const varsHash = hashVariables(variables);
  const startedAt = Date.now();

  const emit = (
    outcome: UpstreamOutcome,
    extra: { httpStatus?: number | null; bytes?: number | null; retryAfter?: string | null; errorClass?: string | null } = {},
  ) => {
    upstreamTelemetry({
      op: "graphql-request",
      operation: operationName,
      ms: Date.now() - startedAt,
      outcome,
      varsHash,
      ...extra,
    });
  };

  const timeoutMs = options.timeoutMs ?? GRAPHQL_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
      emit("timeout", { errorClass: "AbortError" });
      console.error(`[ssi-api] ${operationName} timed out after ${timeoutMs}ms | vars=${JSON.stringify(variables ?? {})}`);
      throw new Error(`Upstream request timed out after ${timeoutMs / 1000}s`);
    }
    emit("fetch-error", { errorClass: err instanceof Error ? err.name : "unknown" });
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

    emit("http-error", { httpStatus: response.status, retryAfter });

    const clientMsg = retryAfter
      ? `Upstream HTTP ${response.status}: ${response.statusText} (Retry-After: ${retryAfter}s)`
      : `Upstream HTTP ${response.status}: ${response.statusText}`;
    throw new Error(clientMsg);
  }

  const bodyText = await response.text();
  let result: GraphQLResponse<T>;
  try {
    result = JSON.parse(bodyText) as GraphQLResponse<T>;
  } catch (err) {
    emit("fetch-error", { errorClass: "JSONParseError", bytes: bodyText.length });
    throw err;
  }

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ");
    console.error(`[ssi-api] ${operationName} GraphQL error | vars=${JSON.stringify(variables ?? {})} | ${msg}`);
    emit("graphql-error", { bytes: bodyText.length });
    throw new Error(msg);
  }

  if (!result.data) {
    console.error(`[ssi-api] ${operationName} empty response | vars=${JSON.stringify(variables ?? {})}`);
    emit("empty", { bytes: bodyText.length });
    throw new Error("Empty response from upstream API");
  }

  emit("ok", { httpStatus: response.status, bytes: bodyText.length });
  return result.data;
}

// ─── Query: match overview ───────────────────────────────────────────────────
// `venue` is on EventInterface (top level). `sub_rule`, `level`, `region`,
// `stages_count`, `competitors_count`, and the nested lists require
// `... on IpscMatchNode`.
//
// `scoring_completed` is requested inside the IpscMatchNode fragment for
// consistency with EVENTS_QUERY (PR #368). It is returned as a decimal string
// (e.g. "56.31067961165048"), not a number — parse with parseFloat().
//
// IMPORTANT: the match-level `scoring_completed` aggregate is unreliable
// upstream. Observed during SPSK Open 2026 (match 22/27190): every stage
// reported 21-29% scored but the match-level field returned "0". A 0 here
// froze the cache TTL on the 5-min "started, no scoring yet" tier and made
// live matches feel stuck. We therefore also request `scoring_completed` on
// each IpscStageNode and derive an effective match-level percentage from the
// per-stage values whenever the match-level value looks broken (see
// `effectiveMatchScoringPct` in lib/match-data.ts).
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
      ... on IpscMatchNode {
        scoring_completed
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
            scoring_completed
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

// ─── Query: match-level "if-modified-since" probe ────────────────────────────
// Tiny probe that returns only `IpscMatchNode.updated`, `status`, `results`.
// Used by `refreshCachedMatchQuery` to skip the heavy MATCH_QUERY/SCORECARDS_QUERY
// refetch when nothing has changed upstream.
//
// Response is ~50 bytes vs. tens-to-hundreds of KB for a full scorecard pull.
export const MATCH_UPDATED_PROBE_QUERY = `
  query MatchUpdatedProbe($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      status
      results
      ... on IpscMatchNode {
        updated
      }
    }
  }
`;

interface MatchUpdatedProbeData {
  event: {
    updated?: string | null;
    status?: string | null;
    results?: string | null;
  } | null;
}

/** Sidecar Redis key storing the last-seen probe state for a match. Shared
 *  across both GetMatch and GetMatchScorecards SWR refreshes for the same
 *  (ct, id) — one probe gates both keys' refetch decisions. */
function probeStateKey(ct: number, id: string): string {
  return `probe:match-state:${ct}:${id}`;
}

interface ProbeState {
  updated: string | null;
  status: string | null;
  results: string | null;
}

function probesEqual(a: ProbeState, b: ProbeState): boolean {
  return a.updated === b.updated && a.status === b.status && a.results === b.results;
}

/** Kill switch: when set to "off", the probe-aware refresh degrades to the
 *  pre-#361 behaviour (always do a full refetch). Used to disable the probe
 *  if `IpscMatchNode.updated` turns out to under-report scorecard activity. */
function isMatchProbeEnabled(): boolean {
  return process.env.MATCH_PROBE_ENABLED !== "off";
}

/** Belt-and-braces ceiling: even when the probe says "no change", never skip
 *  if the cached entry's *original* `cachedAt` is older than this many seconds.
 *  Caps the worst case if `match.updated` lies — at most we'd serve N-seconds
 *  stale data instead of indefinitely-stale. Default 5 minutes; override via
 *  `MATCH_PROBE_MAX_SKIP_AGE_SECONDS`. */
function maxProbeSkipAgeSeconds(): number {
  const raw = process.env.MATCH_PROBE_MAX_SKIP_AGE_SECONDS;
  if (raw == null) return 300;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/** Read the cached entry's original `cachedAt` (the timestamp of the last
 *  *full* fetch, not the last TTL bump) so we can age-cap probe skips.
 *  Returns null if the entry is gone or unparseable. */
async function readCachedAt(cacheKey: string): Promise<string | null> {
  try {
    const raw = await cache.get(cacheKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { cachedAt?: string };
    return entry.cachedAt ?? null;
  } catch {
    return null;
  }
}

/** Sentinel Redis key that any code path can set to force the next probe-aware
 *  refresh to do a clean full refetch — bypassing probe, sidecar, and delta
 *  paths entirely. Cleared after a successful full refresh.
 *
 *  Use cases:
 *   - Admin endpoint exposing a "force-refresh" lever for instant recovery.
 *   - Future detection code that observes suspicious cache shape and invalidates
 *     it for the next user.
 *   - Manual debugging via `redis-cli SET force-refresh:22:12345 1 EX 60`. */
export function forceRefreshKey(ct: number, id: string): string {
  return `force-refresh:${ct}:${id}`;
}

/** Read the force-refresh sentinel; failures default to false (best-effort). */
async function isForceRefreshRequested(ct: number, id: string): Promise<boolean> {
  try {
    const raw = await cache.get(forceRefreshKey(ct, id));
    return raw != null;
  } catch {
    return false;
  }
}

/** Clear the force-refresh sentinel after a successful full refetch. */
async function clearForceRefresh(ct: number, id: string): Promise<void> {
  try {
    await cache.del(forceRefreshKey(ct, id));
  } catch { /* best-effort */ }
}

// Note: the previous PR #366 incremental scorecards delta merge has been
// removed. It depended on `IpscMatchNode.updated` ticking when scorecards
// landed, but that field only reflects match-level admin edits — see the
// comment at the top of `refreshCachedMatchQuery`. The merge helper
// (`mergeScorecardDelta` in `lib/scorecard-merge.ts`) and the delta query
// (`SCORECARDS_DELTA_QUERY` below) are kept around since they are correct
// in isolation and could be revived if SSI ever exposes a usable
// scorecard-mutation timestamp.

/**
 * Probe-aware single-flight refresh of a cached match-level GraphQL query.
 *
 * For the **match overview** key (`GetMatch`), sends a tiny
 * `MatchUpdatedProbe` first; if `IpscMatchNode.updated`, `status`, and
 * `results` all match the last-seen sidecar state, the cache TTL is extended
 * and the full refetch is skipped. Falls back to a full `refreshCachedQuery`
 * on first-seen state, mismatch, or any probe error.
 *
 * For the **scorecards** key (`GetMatchScorecards`), the probe is bypassed:
 * `IpscMatchNode.updated` does not tick when scorecards are added (verified
 * in production during SPSK Open 2026, match 22/27190 — `event.updated`
 * stayed at the prior day's setup time while every stage advanced from 0%
 * to 26% scored). Trusting the probe-skip outcome on the scorecards key
 * pegged refreshes at the `MATCH_PROBE_MAX_SKIP_AGE_SECONDS` ceiling
 * (5 minutes) instead of the intended 30s freshness window. So scorecards
 * always go through `refreshCachedQuery`.
 */
export async function refreshCachedMatchQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
  match: { ct: number; id: string },
  lockTtlSeconds = 90,
): Promise<void> {
  const parsed = parseMatchCacheKey(cacheKey);
  const keyType: "match" | "scorecards" | "other" =
    parsed?.keyType === "match" ? "match"
      : parsed?.keyType === "scorecards" ? "scorecards"
      : "other";

  // Kill switch: degrade to the original always-refetch path. Kept as a
  // belt-and-braces lever even though scorecards are now bypassed by default
  // — if the match-overview probe path is itself observed misbehaving, this
  // disables it without a code deploy.
  if (!isMatchProbeEnabled()) {
    return refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds);
  }

  // Force-refresh sentinel: any code path (admin endpoint, recovery script)
  // can request a clean full refetch by setting `force-refresh:{ct}:{id}` in
  // Redis. Bypasses probe, sidecar, and delta entirely. After a successful
  // refresh the sentinel is cleared. Applies to both keytypes so the admin
  // lever flushes match overview AND scorecards in the same gesture.
  if (await isForceRefreshRequested(match.ct, match.id)) {
    await refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds);
    await clearForceRefresh(match.ct, match.id);
    cacheTelemetry({
      op: "match-probe",
      matchKey: cacheKey,
      keyType,
      outcome: "forced-refresh",
      probeMs: 0,
      cachedAgeSeconds: null,
      upstreamUpdatedIso: null,
      prevUpstreamUpdatedIso: null,
    });
    return;
  }

  // Scorecards bypass: the probe field (`IpscMatchNode.updated`) cannot
  // detect new scorecards — verified in production during SPSK Open 2026
  // (match 22/27190): event.updated stayed at the prior day's setup time
  // while every stage advanced from 0% to 26% scored. Skipping a scorecards
  // refetch based on the probe strands the cache at the
  // `MATCH_PROBE_MAX_SKIP_AGE_SECONDS` ceiling (5 minutes). Always do a
  // full refetch for scorecards; the shared probe sidecar is still
  // maintained by the match-key path so the overview optimization is
  // unaffected.
  if (keyType === "scorecards") {
    return refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds);
  }

  const lockKey = `inflight:${cacheKey}`;
  let acquired = false;
  try {
    acquired = await cache.setIfAbsent(lockKey, "1", lockTtlSeconds);
  } catch {
    return;
  }
  if (!acquired) return;

  const sidecarKey = probeStateKey(match.ct, match.id);
  const probeStartedAt = Date.now();
  let probeOutcome: "skip" | "changed" | "first-seen" | "error" | "forced-refresh" = "error";
  let cachedAgeSeconds: number | null = null;
  let upstreamUpdatedIso: string | null = null;
  let prevUpstreamUpdatedIso: string | null = null;

  try {
    let prevState: ProbeState | null = null;
    try {
      const raw = await cache.get(sidecarKey);
      if (raw) prevState = JSON.parse(raw) as ProbeState;
    } catch {
      // Sidecar read failed — proceed as first-seen.
    }

    let probeData: MatchUpdatedProbeData;
    try {
      probeData = await executeQuery<MatchUpdatedProbeData>(MATCH_UPDATED_PROBE_QUERY, variables);
    } catch {
      // Probe itself failed — fall through to a full refetch via refreshCachedQuery.
      probeOutcome = "error";
      await fullRefresh<T>(cacheKey, query, variables, ttlSeconds);
      return;
    }

    const ev = probeData.event;
    if (!ev) {
      // Match deleted/unavailable upstream — let the full refresh handle it.
      probeOutcome = "error";
      await fullRefresh<T>(cacheKey, query, variables, ttlSeconds);
      return;
    }

    const currentState: ProbeState = {
      updated: ev.updated ?? null,
      status: ev.status ?? null,
      results: ev.results ?? null,
    };
    upstreamUpdatedIso = currentState.updated;
    prevUpstreamUpdatedIso = prevState?.updated ?? null;

    if (prevState && probesEqual(prevState, currentState)) {
      // Probe says nothing changed — but cap how long we'll trust that. If the
      // cached entry's *original* fetch is older than the max-skip-age ceiling,
      // force a full refetch anyway. This bounds worst-case staleness if
      // `match.updated` under-reports scorecard activity.
      const cachedAt = await readCachedAt(cacheKey);
      const ageSeconds = cachedAt
        ? (Date.now() - new Date(cachedAt).getTime()) / 1000
        : Infinity; // unknown age → assume too old, force refresh
      cachedAgeSeconds = Number.isFinite(ageSeconds) ? ageSeconds : null;
      if (ageSeconds > maxProbeSkipAgeSeconds()) {
        probeOutcome = "forced-refresh";
        await fullRefresh<T>(cacheKey, query, variables, ttlSeconds);
        try {
          await cache.set(sidecarKey, JSON.stringify(currentState), ttlSeconds ?? null);
        } catch { /* sidecar write failure is non-fatal */ }
        return;
      }

      // Within the safety window — extend the existing cache TTL and skip
      // the heavy refetch.
      probeOutcome = "skip";
      if (ttlSeconds !== null) {
        try {
          await cache.expire(cacheKey, ttlSeconds);
        } catch {
          // Entry may have been evicted — fall through silently. The next
          // request will hit the fallback / GraphQL path and self-heal.
        }
        try {
          await cache.expire(sidecarKey, ttlSeconds);
        } catch { /* sidecar TTL miss is harmless */ }
      }
      return;
    }

    // First-seen or state changed — do the full refresh, then update sidecar.
    // Note: scorecards keys never reach this path (early-returned at the top
    // of the function). The `keyType === "scorecards"` delta-merge branch
    // that used to live here was unreachable in practice — `event.updated`
    // does not tick when scorecards land, so probeOutcome was never
    // "changed" for that keyType — and removing it keeps the contract clear.
    probeOutcome = prevState ? "changed" : "first-seen";

    await fullRefresh<T>(cacheKey, query, variables, ttlSeconds);
    try {
      await cache.set(sidecarKey, JSON.stringify(currentState), ttlSeconds ?? null);
    } catch {
      // Sidecar write failure just costs us one extra full refetch next cycle.
    }
  } finally {
    cacheTelemetry({
      op: "match-probe",
      matchKey: cacheKey,
      keyType,
      outcome: probeOutcome,
      probeMs: Date.now() - probeStartedAt,
      cachedAgeSeconds,
      upstreamUpdatedIso,
      prevUpstreamUpdatedIso,
    });
    try {
      await cache.del(lockKey);
    } catch { /* lock will expire via TTL */ }
  }
}

/**
 * Inner: do the actual full refresh + cache write + D1 mirror. Mirrors
 * `refreshCachedQuery` but without the lock (caller holds it).
 */
async function fullRefresh<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
): Promise<void> {
  try {
    const data = await executeQuery<T>(query, variables);
    const entry: CacheEntry<T> = {
      data,
      cachedAt: new Date().toISOString(),
      v: CACHE_SCHEMA_VERSION,
    };
    const payload = JSON.stringify(entry);
    await cache.set(cacheKey, payload, ttlSeconds);
    if (parseMatchCacheKey(cacheKey)) {
      afterResponse(persistActiveMatchToD1(cacheKey, payload));
    }
  } catch (err) {
    console.error("[cache] background refresh failed for key:", cacheKey, err);
    await markUpstreamDegraded(
      "refresh-cached-match-query",
      err instanceof Error ? err.name : null,
    );
    if (ttlSeconds !== null) {
      try {
        await cache.expire(cacheKey, ttlSeconds);
      } catch { /* entry may already be gone — D1 fallback covers it */ }
    }
  }
}

/// ─── Query: list IPSC events ──────────────────────────────────────────────────
// Returns all publicly-visible IPSC matches filtered by optional free-text
// search, date range, and firearms type.
// Results include both IpscMatchNode (ct=22) and IpscSerieNode (ct=43) —
// filter to ct=22 in the route handler (all IPSC disciplines share ct=22).
// `region` is an ISO 3166-1 alpha-3 country code (e.g. "SWE", "NOR", "DNK",
// "FIN"). Country filtering is done server-side in the route handler after
// the GraphQL response is received — the SSI API has no region filter param.
//
// `scoring_completed` is gated behind a $includeScoring variable + @include
// directive — it is a server-computed aggregate (scans every scorecard for
// every match in the result set) that adds 10+ seconds to the worldwide
// browse query. Live mode passes `includeScoring: true` because it needs the
// progress percentage to filter active matches; browse and search pass false
// because they only display name/date/venue/level. Empirically: same query,
// same window, against SSI: 0.25s without scoring_completed, 11-13s with it.
export const EVENTS_QUERY = `
  query GetEvents($search: String, $starts_after: String, $starts_before: String, $firearms: String, $includeScoring: Boolean!) {
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
        scoring_completed @include(if: $includeScoring)
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
    const payload = JSON.stringify(entry);
    await cache.set(cacheKey, payload, ttlSeconds);
    // Mirror the fresh payload into D1 for match keys so the durable store
    // stays current with the hot Redis cache. Throttled inside the helper.
    if (parseMatchCacheKey(cacheKey)) {
      afterResponse(persistActiveMatchToD1(cacheKey, payload));
    }
  } catch (err) {
    console.error("[cache] background refresh failed for key:", cacheKey, err);
    // Mark the upstream as degraded so handlers can surface a banner to users.
    // Best-effort — failure to write the flag is silently swallowed.
    await markUpstreamDegraded(
      "refresh-cached-query",
      err instanceof Error ? err.name : null,
    );
    // Stale-on-error: extend the existing entry's TTL so users keep seeing
    // last-known-good data through transient upstream outages. Without this,
    // the entry would tick toward eviction while every refresh attempt fails,
    // and a Redis miss during the outage would surface a hard 502 to clients.
    if (ttlSeconds !== null) {
      try {
        await cache.expire(cacheKey, ttlSeconds);
      } catch { /* entry may already be gone — D1 fallback covers it */ }
    }
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

  const entry: CacheEntry<T> = { data, cachedAt, v: CACHE_SCHEMA_VERSION };
  const payload = JSON.stringify(entry);
  try {
    await cache.set(cacheKey, payload, ttlSeconds);
  } catch (err) {
    console.error("[cache] write error for key:", cacheKey, err);
  }

  // Mirror match keys to D1 as a "last known good" durable fallback so a
  // Redis eviction during an upstream outage doesn't surface a 502. Throttled
  // inside the helper to bound write volume on hot paths.
  if (parseMatchCacheKey(cacheKey)) {
    afterResponse(persistActiveMatchToD1(cacheKey, payload));
  }

  // Record access for popularity tracking (fire-and-forget, non-fatal).
  if (cacheKey.startsWith("gql:GetMatch:") && !(await isAdminRequest())) {
    void db.recordMatchAccess(cacheKey).catch(() => {});
  }

  // Return null for cachedAt: freshly fetched, not served from cache
  return { data, cachedAt: null };
}

// ─── Shared scorecard field set ──────────────────────────────────────────────
// CRITICAL: SCORECARDS_QUERY and SCORECARDS_DELTA_QUERY MUST request the same
// scorecard fields. The delta merge (#362, lib/scorecard-merge.ts) writes
// delta entries into the cached full snapshot — if the delta is missing fields
// the full query has, the merge silently corrupts the cached entry.
//
// This shared constant is interpolated into both queries so they CANNOT drift.
//
// When adding a scorecard field, see CLAUDE.md → "Delta-merge contract" for
// the full list of files that must be updated together. In short:
//   1. Add to SCORECARD_NODE_FIELDS (here)
//   2. Add to RawScCard (lib/scorecard-data.ts)
//   3. Add to ScorecardDeltaEntry (this file)
//   4. Copy in deltaToCacheCard() (lib/scorecard-merge.ts)
//   5. Bump CACHE_SCHEMA_VERSION (lib/constants.ts)
//   6. Run `pnpm check:ssi-schema --update` and commit the snapshot diff
const SCORECARD_NODE_FIELDS = `
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
`;

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
            ${SCORECARD_NODE_FIELDS}
          }
        }
      }
    }
  }
`;

// ─── Query: incremental scorecard delta ──────────────────────────────────────
// Fetches only scorecards whose `updated` timestamp is strictly after `since`.
// Single match-level round-trip (not per-stage) — each scorecard returns its
// `stage.id` so the merge step can re-bucket into the cached per-stage shape.
//
// Validated empirically: SSI accepts ISO 8601 with timezone (the format
// `IpscMatchNode.updated` itself returns), so we just pass that value back
// as the `since` parameter.
//
// The scorecard field set MUST stay in sync with SCORECARDS_QUERY — the merge
// produces the same on-disk shape as a full fetch, so the cache schema version
// covers both. Any field added to SCORECARDS_QUERY must be added here too.
export const SCORECARDS_DELTA_QUERY = `
  query GetMatchScorecardsDelta($ct: Int!, $id: String!, $since: String!) {
    event(content_type: $ct, id: $id) {
      ... on IpscMatchNode {
        scorecards(updated_after: $since) {
          ... on IpscScoreCardNode {
            stage { id }
          }
          ${SCORECARD_NODE_FIELDS}
        }
      }
    }
  }
`;

export interface ScorecardDeltaEntry {
  stage: { id: string };
  created?: string | null;
  points?: number | string | null;
  hitfactor?: number | string | null;
  time?: number | string | null;
  disqualified?: boolean | null;
  zeroed?: boolean | null;
  stage_not_fired?: boolean | null;
  incomplete?: boolean | null;
  ascore?: number | string | null;
  bscore?: number | string | null;
  cscore?: number | string | null;
  dscore?: number | string | null;
  miss?: number | string | null;
  penalty?: number | string | null;
  procedural?: number | string | null;
  competitor?: {
    id: string;
    first_name?: string;
    last_name?: string;
    number?: string;
    club?: string | null;
    get_division_display?: string | null;
    handgun_div?: string | null;
    get_handgun_div_display?: string | null;
    region?: string | null;
    get_region_display?: string | null;
    category?: string | null;
    ics_alias?: string | null;
    license?: string | null;
  } | null;
}

export interface ScorecardDeltaData {
  event: {
    scorecards?: ScorecardDeltaEntry[];
  } | null;
}
