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
import { mergeScorecardDelta } from "@/lib/scorecard-merge";
import type { RawScorecardsData } from "@/lib/scorecard-data";

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
      emit("timeout", { errorClass: "AbortError" });
      console.error(`[ssi-api] ${operationName} timed out after ${GRAPHQL_TIMEOUT_MS}ms | vars=${JSON.stringify(variables ?? {})}`);
      throw new Error(`Upstream request timed out after ${GRAPHQL_TIMEOUT_MS / 1000}s`);
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

/** Kill switch for the incremental scorecard delta path. When off, the
 *  `changed` probe outcome falls through to a full refetch — same as #361
 *  alone. Use this if the delta path proves buggy in production. */
function isScorecardsDeltaEnabled(): boolean {
  return process.env.SCORECARDS_DELTA_ENABLED !== "off";
}

/** Reconcile interval (seconds): even when delta merges succeed, force a
 *  periodic full refetch to self-heal from drift the delta cannot detect:
 *    - scorecards deleted upstream (DQ reversals, admin deletes)
 *    - new stages added to the match
 *    - subtle merge bugs that don't trigger structural failures
 *  Default 10 minutes — at the 30s active-match polling cadence that's one
 *  reconcile per ~20 polls. The cached entry's *original* `cachedAt` is the
 *  timer reference; delta merges intentionally do NOT bump it so the reconcile
 *  timer keeps ticking on a steady delta stream. */
function scorecardsDeltaMaxAgeSeconds(): number {
  const raw = process.env.SCORECARDS_DELTA_MAX_AGE_SECONDS;
  if (raw == null) return 600;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
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

interface DeltaMergeAttempt {
  outcome: "delta-merge" | "full-fallback" | "reconcile" | "error" | "disabled";
  /** Number of scorecards in the delta payload. */
  deltaCount: number;
  /** Number of cached scorecards replaced by the merge. */
  updatedCount: number;
  /** Number of scorecards added by the merge. */
  addedCount: number;
  /** Pure-merge time (ms). Excludes upstream fetch + cache I/O. */
  mergeMs: number;
  /** Bytes returned by the delta query (vs. full refetch payload). */
  deltaBytes: number | null;
  /** Short reason string when outcome is `full-fallback` or `error`. */
  reason: string | null;
}

/**
 * Attempt a delta merge for a `GetMatchScorecards` cache entry. Returns the
 * outcome details for telemetry; on `delta-merge` / `reconcile` the cache has
 * been updated. On `full-fallback` / `error` / `disabled` the caller should
 * run a full refresh.
 */
async function tryScorecardsDeltaMerge(
  cacheKey: string,
  variables: { ct: number; id: string },
  since: string,
  ttlSeconds: number | null,
): Promise<DeltaMergeAttempt> {
  if (!isScorecardsDeltaEnabled()) {
    return { outcome: "disabled", deltaCount: 0, updatedCount: 0, addedCount: 0, mergeMs: 0, deltaBytes: null, reason: null };
  }

  let cachedEntry: CacheEntry<RawScorecardsData>;
  let cachedAtIso: string;
  try {
    const raw = await cache.get(cacheKey);
    if (!raw) {
      return { outcome: "full-fallback", deltaCount: 0, updatedCount: 0, addedCount: 0, mergeMs: 0, deltaBytes: null, reason: "no-cached-entry" };
    }
    cachedEntry = JSON.parse(raw) as CacheEntry<RawScorecardsData>;
    cachedAtIso = cachedEntry.cachedAt;
    if (cachedEntry.v !== CACHE_SCHEMA_VERSION) {
      return { outcome: "full-fallback", deltaCount: 0, updatedCount: 0, addedCount: 0, mergeMs: 0, deltaBytes: null, reason: "schema-version-mismatch" };
    }
  } catch {
    return { outcome: "full-fallback", deltaCount: 0, updatedCount: 0, addedCount: 0, mergeMs: 0, deltaBytes: null, reason: "cache-read-error" };
  }

  // Reconcile gate: if the cached entry's *original* fetch is older than the
  // ceiling, force a full refetch even though a delta would merge cleanly.
  // Self-heals from upstream deletions and stage additions.
  const cacheAgeSeconds = (Date.now() - new Date(cachedAtIso).getTime()) / 1000;
  if (cacheAgeSeconds > scorecardsDeltaMaxAgeSeconds()) {
    return { outcome: "reconcile", deltaCount: 0, updatedCount: 0, addedCount: 0, mergeMs: 0, deltaBytes: null, reason: null };
  }

  let deltaData: ScorecardDeltaData;
  let deltaBytes: number | null = null;
  try {
    // We can't get bytes here (executeQuery does, but doesn't expose it);
    // approximate with serialized JSON length post-fetch.
    deltaData = await executeQuery<ScorecardDeltaData>(SCORECARDS_DELTA_QUERY, { ...variables, since });
    try { deltaBytes = JSON.stringify(deltaData).length; } catch { /* ignore */ }
  } catch (err) {
    return {
      outcome: "error",
      deltaCount: 0,
      updatedCount: 0,
      addedCount: 0,
      mergeMs: 0,
      deltaBytes: null,
      reason: err instanceof Error ? err.name : "fetch-error",
    };
  }

  const delta = deltaData.event?.scorecards ?? [];
  const t0 = Date.now();
  const merge = mergeScorecardDelta(cachedEntry.data, delta);
  const mergeMs = Date.now() - t0;

  if (!merge.ok) {
    return {
      outcome: "full-fallback",
      deltaCount: delta.length,
      updatedCount: 0,
      addedCount: 0,
      mergeMs,
      deltaBytes,
      reason: merge.reason,
    };
  }

  // Write the merged snapshot back. CRITICAL: keep the original `cachedAt`
  // so the reconcile timer keeps ticking on a steady delta stream.
  const newEntry: CacheEntry<RawScorecardsData> = {
    data: merge.data,
    cachedAt: cachedAtIso,
    v: CACHE_SCHEMA_VERSION,
  };
  const payload = JSON.stringify(newEntry);
  try {
    await cache.set(cacheKey, payload, ttlSeconds);
  } catch {
    // Cache write failed — surface as full-fallback so caller does a full
    // refetch and writes a coherent snapshot via the standard path.
    return {
      outcome: "full-fallback",
      deltaCount: delta.length,
      updatedCount: merge.updatedCount,
      addedCount: merge.addedCount,
      mergeMs,
      deltaBytes,
      reason: "cache-write-error",
    };
  }
  if (parseMatchCacheKey(cacheKey)) {
    afterResponse(persistActiveMatchToD1(cacheKey, payload));
  }

  return {
    outcome: "delta-merge",
    deltaCount: delta.length,
    updatedCount: merge.updatedCount,
    addedCount: merge.addedCount,
    mergeMs,
    deltaBytes,
    reason: null,
  };
}

/**
 * Probe-aware single-flight refresh of a cached match-level GraphQL query
 * (GetMatch or GetMatchScorecards). Sends a tiny `MatchUpdatedProbe` first;
 * if `IpscMatchNode.updated` (and `status`/`results`) match the last-seen
 * sidecar state, just extend the cache TTL and skip the full refetch entirely.
 *
 * Falls back to a full `refreshCachedQuery` on first-seen state, mismatch,
 * or any probe error.
 */
export async function refreshCachedMatchQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
  match: { ct: number; id: string },
  lockTtlSeconds = 90,
): Promise<void> {
  // Kill switch: degrade to the original always-refetch path. Useful if the
  // upstream `match.updated` field turns out not to track scorecard entry
  // (e.g. only bumps on match-level admin edits, not per-scorecard saves).
  if (!isMatchProbeEnabled()) {
    return refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds);
  }

  // Force-refresh sentinel: any code path (admin endpoint, recovery script)
  // can request a clean full refetch by setting `force-refresh:{ct}:{id}` in
  // Redis. We bypass probe, sidecar, and delta entirely. After a successful
  // refresh the sentinel is cleared. Both probe (#361) and delta (#362)
  // paths respect this for symmetry.
  if (await isForceRefreshRequested(match.ct, match.id)) {
    await refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds);
    await clearForceRefresh(match.ct, match.id);
    cacheTelemetry({
      op: "match-probe",
      matchKey: cacheKey,
      keyType:
        parseMatchCacheKey(cacheKey)?.keyType === "match" ? "match"
          : parseMatchCacheKey(cacheKey)?.keyType === "scorecards" ? "scorecards"
          : "other",
      outcome: "forced-refresh",
      probeMs: 0,
      cachedAgeSeconds: null,
      upstreamUpdatedIso: null,
      prevUpstreamUpdatedIso: null,
    });
    return;
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
  const parsed = parseMatchCacheKey(cacheKey);
  const keyType: "match" | "scorecards" | "other" =
    parsed?.keyType === "match" ? "match"
      : parsed?.keyType === "scorecards" ? "scorecards"
      : "other";

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
    probeOutcome = prevState ? "changed" : "first-seen";

    // Delta path: on `changed` for a scorecards key, try fetching only the
    // delta scorecards (`scorecards(updated_after: prev_match_updated)`) and
    // merging into the cached snapshot. Falls through to the full refresh on
    // any failure or when the periodic reconcile is due.
    let deltaAttempt: DeltaMergeAttempt | null = null;
    const canTryDelta =
      keyType === "scorecards" &&
      probeOutcome === "changed" &&
      prevState?.updated != null;
    if (canTryDelta && prevState?.updated) {
      deltaAttempt = await tryScorecardsDeltaMerge(
        cacheKey,
        match,
        prevState.updated,
        ttlSeconds,
      );
    }

    const skipFullRefresh =
      deltaAttempt?.outcome === "delta-merge";

    if (!skipFullRefresh) {
      await fullRefresh<T>(cacheKey, query, variables, ttlSeconds);
    }
    try {
      await cache.set(sidecarKey, JSON.stringify(currentState), ttlSeconds ?? null);
    } catch {
      // Sidecar write failure just costs us one extra full refetch next cycle.
    }

    if (deltaAttempt) {
      cacheTelemetry({
        op: "scorecards-delta",
        matchKey: cacheKey,
        outcome: deltaAttempt.outcome,
        deltaCount: deltaAttempt.deltaCount,
        updatedCount: deltaAttempt.updatedCount,
        addedCount: deltaAttempt.addedCount,
        mergeMs: deltaAttempt.mergeMs,
        deltaBytes: deltaAttempt.deltaBytes,
        reason: deltaAttempt.reason,
      });
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
    await markUpstreamDegraded();
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
      scoring_completed
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
    await markUpstreamDegraded();
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
