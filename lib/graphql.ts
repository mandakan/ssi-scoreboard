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
import { reportError } from "@/lib/error-telemetry";
import { isPublicMatchData } from "@/lib/visibility";
import { getJwt, JWT_EXPIRED_ERROR_PATTERNS } from "@/lib/ssi-auth";
import { assertSsiUpstreamAllowed } from "@/lib/upstream-pause";
import { withUpstreamSlot } from "@/lib/upstream-limiter";
import {
  assertNotInBackoff,
  recordUpstreamFailure,
  recordUpstreamSuccess,
} from "@/lib/upstream-backoff";
import { shouldProbeNow, recordProbeOutcome } from "@/lib/probe-cadence";

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
    if (JWT_EXPIRED_ERROR_PATTERNS.some((m) => msg.includes(m))) {
      // JWT rejected by SSI — force-refresh once and retry. Covers the
      // window where our cached JWT has expired but the next isolate hasn't
      // re-minted yet, and the cold-start case where a stale Redis entry
      // outlives its actual exp claim.
      await getJwt({ force: true });
      return await executeQueryOnce<T>(query, variables, revalidate, options);
    }
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
  // Emergency kill switch — throws before any outbound traffic (including the
  // JWT fetch below). See lib/upstream-pause.ts.
  assertSsiUpstreamAllowed();
  // Exponential backoff gate (SSI ask #8): while a hold-off window from
  // recent 429/5xx/timeouts is active, fail fast — stale-on-error serves
  // cached data instead of piling onto a struggling upstream.
  await assertNotInBackoff();

  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) throw new Error("SSI_API_KEY is not configured");

  // SSI now requires both `x-api-key` AND a JWT (`Authorization: JWT <token>`)
  // on every resolver. See lib/ssi-auth.ts for the lifecycle.
  const jwt = await getJwt();

  // Extract the operation name for log context, e.g. "GetMatchScorecards"
  const operationName = query.match(/query\s+(\w+)/)?.[1] ?? "unknown";
  const varsHash = hashVariables(variables);
  // Reset once the semaphore slot is acquired so telemetry `ms` measures the
  // upstream request, not time spent queueing behind other calls.
  let startedAt = Date.now();

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

  // Semaphore: at most UPSTREAM_MAX_CONCURRENCY (default 2) outbound requests
  // per isolate — an SSI requirement after the 2026-08-15 incident. The whole
  // network interaction (fetch + body read) happens inside the slot; the
  // request timeout starts after acquisition so queueing never counts
  // against it.
  const { response, bodyText } = await withUpstreamSlot(async () => {
    startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? GRAPHQL_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `JWT ${jwt}`,
          "x-api-key": apiKey,
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
        await recordUpstreamFailure(null);
        console.error(`[ssi-api] ${operationName} timed out after ${timeoutMs}ms | vars=${JSON.stringify(variables ?? {})}`);
        throw new Error(`Upstream request timed out after ${timeoutMs / 1000}s`);
      }
      emit("fetch-error", { errorClass: err instanceof Error ? err.name : "unknown" });
      throw err;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const retryAfter = res.headers.get("Retry-After");
      let body = "";
      try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }

      const parts = [
        `[ssi-api] ${operationName} failed`,
        `HTTP ${res.status} ${res.statusText}`,
        `vars=${JSON.stringify(variables ?? {})}`,
        retryAfter ? `Retry-After=${retryAfter}` : null,
        body ? `body=${body}` : null,
      ].filter(Boolean);
      console.error(parts.join(" | "));

      emit("http-error", { httpStatus: res.status, retryAfter });
      if (res.status === 429 || res.status >= 500) {
        await recordUpstreamFailure(retryAfter);
      }

      const clientMsg = retryAfter
        ? `Upstream HTTP ${res.status}: ${res.statusText} (Retry-After: ${retryAfter}s)`
        : `Upstream HTTP ${res.status}: ${res.statusText}`;
      throw new Error(clientMsg);
    }

    return { response: res, bodyText: await res.text() };
  });
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
    // Skip error-domain telemetry for JWT-expiry messages: the outer
    // `executeQuery` wrapper force-refreshes the JWT and retries once, and
    // the retry almost always succeeds. Surfacing these in the error feed
    // produces false-alarm noise in the admin dashboard. The upstream
    // `graphql-error` outcome above still records the first-attempt failure
    // for operational debugging.
    if (!JWT_EXPIRED_ERROR_PATTERNS.some((p) => msg.includes(p))) {
      const ct = typeof variables?.ct === "number" || typeof variables?.ct === "string" ? variables.ct : null;
      const matchId = typeof variables?.id === "string" ? variables.id : null;
      reportError(`ssi-graphql-error:${operationName}`, new Error(msg), { ct, matchId, varsHash });
    }
    // Key rejection is not retryable and not transient — every subsequent
    // call will fail identically until a human changes something. SSI returns
    // it as HTTP 200 with an errors array, so the 429/5xx branch above never
    // sees it and the backoff never engaged: on 2026-08-22 (a Saturday, when
    // SSI's key is disabled by design) we sent ~800 pointless requests, 670 in
    // one hour. Trip the shared backoff so the whole fleet stops asking.
    if (isApiKeyRejection(msg)) {
      await recordUpstreamFailure(null);
    }
    throw new Error(msg);
  }

  if (!result.data) {
    console.error(`[ssi-api] ${operationName} empty response | vars=${JSON.stringify(variables ?? {})}`);
    emit("empty", { bytes: bodyText.length });
    throw new Error("Empty response from upstream API");
  }

  emit("ok", { httpStatus: response.status, bytes: bodyText.length });
  // Half-open backoff reset — only clears state once a hold-off has elapsed.
  await recordUpstreamSuccess();
  return result.data;
}

// ─── Query: match overview ───────────────────────────────────────────────────
// `venue` is on EventInterface (top level). `sub_rule`, `level`, `region`,
// `stages_count`, `competitors_count`, and the nested lists require
// `... on IpscMatchNode`.
//
// Match-level scoring percentage is derived from per-stage `scoring_progress`
// (the SSI replacement for the now-deprecated `scoring_completed` field —
// SSI marks the latter as "Always returns 0" and points at scoring_progress
// in the deprecation reason). See `computeMatchScoringPct` in
// lib/match-data.ts for the aggregation.
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
/**
 * Does this GraphQL error mean SSI rejected our `x-api-key` outright?
 *
 * Distinct from the JWT-expiry messages, which ARE transient and are handled
 * by the force-refresh-and-retry path in `executeQuery`. A rejected API key
 * stays rejected until a human acts, so it should open the backoff gate
 * rather than be retried per request.
 *
 * The common cause is not a revoked key at all: SSI enables our key on
 * weekdays only, so every weekend it reads as invalid.
 */
export function isApiKeyRejection(msg: string): boolean {
  return /invalid api key/i.test(msg);
}

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
        visibility
        get_visibility_display
        is_live_scores_accessible
        role_names
        is_current_role_admin
        is_current_role_assistant
        is_current_role_staff
        organizer {
          id
          name
          short_name
          org_type
        }
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
            scoring_progress {
              scored
              total
            }
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

// ─── Query: match-level sync probe ───────────────────────────────────────────
// One tiny query per refresh cycle drives BOTH cache keys (2026-08-15
// SSI-load redesign):
//  - event-level fields (`updated`, `status`, `results`,
//    `is_live_scores_accessible`, `latest_competitor_update`,
//    `competitors_count`) gate the heavy MATCH_QUERY refetch
//  - per-stage `{latest_scorecard_update, scorecards_count, scoring_progress}`
//    lets the scorecards refresh fetch ONLY stages that actually changed
//    (lib/scorecards-archive.ts `refreshScorecardsIncremental`), replacing
//    the old full per-stage fan-out every cycle.
//
// Response is a few hundred bytes vs. tens-to-hundreds of KB for a full pull.
export const MATCH_SYNC_PROBE_QUERY = `
  query MatchSyncProbe($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      status
      results
      ... on IpscMatchNode {
        updated
        is_live_scores_accessible
        latest_competitor_update
        competitors_count
        stages {
          id
          ... on IpscStageNode {
            latest_scorecard_update
            scorecards_count
            scoring_progress {
              scored
              total
            }
          }
        }
      }
    }
  }
`;

export interface ProbeStageData {
  id: string;
  /** Max `updated` across the stage's scorecards (SSI change marker,
   *  2026-08-18). `IpscStageNode.updated` tracks stage-info edits only and
   *  must NOT be used as a results-change signal (SSI instruction). */
  latest_scorecard_update?: string | null;
  scorecards_count?: number | null;
  scoring_progress?: { scored?: number | null; total?: number | null } | null;
}

export interface MatchSyncProbeData {
  event: {
    updated?: string | null;
    status?: string | null;
    results?: string | null;
    is_live_scores_accessible?: boolean | null;
    latest_competitor_update?: string | null;
    competitors_count?: number | null;
    stages?: ProbeStageData[] | null;
  } | null;
}

// One refresh cycle typically fires both the match-key and scorecards-key
// refreshes for the same (ct, id) within seconds of each other. Memoize the
// probe per isolate for a short window so a single upstream probe serves both.
const PROBE_MEMO_TTL_MS = 5_000;
const probeMemo = new Map<string, { at: number; promise: Promise<MatchSyncProbeData> }>();

export async function runMatchSyncProbe(ct: number, id: string): Promise<MatchSyncProbeData> {
  const key = `${ct}:${id}`;
  const hit = probeMemo.get(key);
  if (hit && Date.now() - hit.at < PROBE_MEMO_TTL_MS) return hit.promise;
  const promise = executeQuery<MatchSyncProbeData>(MATCH_SYNC_PROBE_QUERY, { ct, id });
  probeMemo.set(key, { at: Date.now(), promise });
  // A failed probe must not poison the memo window for the next cycle.
  promise.catch(() => probeMemo.delete(key));
  return promise;
}

/** Test hook — clears the per-isolate probe memo. */
export function clearMatchSyncProbeMemo(): void {
  probeMemo.clear();
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
  isLiveScoresAccessible: boolean | null;
  /** Competitor change markers (SSI 2026-08-18): catch registrations/edits
   *  that don't tick `event.updated`; a count DROP detects deletions (the
   *  max-date marker can't move backwards). Optional so sidecars written
   *  before this field existed compare as null, not undefined. */
  latestCompetitorUpdate?: string | null;
  competitorsCount?: number | null;
}

function probesEqual(a: ProbeState, b: ProbeState): boolean {
  return (
    a.updated === b.updated &&
    a.status === b.status &&
    a.results === b.results &&
    a.isLiveScoresAccessible === b.isLiveScoresAccessible &&
    (a.latestCompetitorUpdate ?? null) === (b.latestCompetitorUpdate ?? null) &&
    (a.competitorsCount ?? null) === (b.competitorsCount ?? null)
  );
}

/** Kill switch: when set to "off", the probe-aware refresh degrades to the
 *  pre-#361 behaviour (always do a full refetch). Used to disable the probe
 *  if `IpscMatchNode.updated` turns out to under-report scorecard activity.
 *  NOTE: "off" INCREASES upstream load — never use it as a load-shedding
 *  lever; that's what SSI_UPSTREAM_PAUSED and the backoff gate are for. */
export function isMatchProbeEnabled(): boolean {
  return process.env.MATCH_PROBE_ENABLED !== "off";
}

/** Belt-and-braces ceiling: even when the probe says "no change", never skip
 *  if the last *full* fetch is older than this many seconds. Caps the worst
 *  case if the probe under-reports — at most we'd serve N-seconds stale data
 *  instead of indefinitely-stale. Raised 300 -> 900 in the 2026-08-15
 *  SSI-load redesign: the probe now carries per-stage scoring_progress, so
 *  the expensive full refetch is only a drift safety net, not the scoring
 *  freshness mechanism. Override via `MATCH_PROBE_MAX_SKIP_AGE_SECONDS`. */
export function maxProbeSkipAgeSeconds(): number {
  const raw = process.env.MATCH_PROBE_MAX_SKIP_AGE_SECONDS;
  if (raw == null) return 900;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 900;
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
export async function isForceRefreshRequested(ct: number, id: string): Promise<boolean> {
  try {
    const raw = await cache.get(forceRefreshKey(ct, id));
    return raw != null;
  } catch {
    return false;
  }
}

/** Clear the force-refresh sentinel after a successful full refetch. */
export async function clearForceRefresh(ct: number, id: string): Promise<void> {
  try {
    await cache.del(forceRefreshKey(ct, id));
  } catch { /* best-effort */ }
}

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
  options: RefreshCachedQueryOptions<T> = {},
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
    return refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds, options);
  }

  // Force-refresh sentinel: any code path (admin endpoint, recovery script)
  // can request a clean full refetch by setting `force-refresh:{ct}:{id}` in
  // Redis. Bypasses probe, sidecar, and delta entirely. After a successful
  // refresh the sentinel is cleared. Applies to both keytypes so the admin
  // lever flushes match overview AND scorecards in the same gesture.
  if (await isForceRefreshRequested(match.ct, match.id)) {
    await refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds, options);
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
    return refreshCachedQuery<T>(cacheKey, query, variables, ttlSeconds, lockTtlSeconds, options);
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
    // Adaptive idle cadence (#503): during an idle hold-off, skip the probe
    // entirely — just keep the cache entry alive.
    if (!(await shouldProbeNow(match.ct, match.id))) {
      probeOutcome = "skip";
      if (ttlSeconds !== null) {
        try { await cache.expire(cacheKey, ttlSeconds); } catch { /* self-heals */ }
        try { await cache.expire(sidecarKey, ttlSeconds); } catch { /* harmless */ }
      }
      return;
    }

    let prevState: ProbeState | null = null;
    try {
      const raw = await cache.get(sidecarKey);
      if (raw) prevState = JSON.parse(raw) as ProbeState;
    } catch {
      // Sidecar read failed — proceed as first-seen.
    }

    let probeData: MatchSyncProbeData;
    try {
      probeData = await runMatchSyncProbe(match.ct, match.id);
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
      isLiveScoresAccessible: ev.is_live_scores_accessible ?? null,
      latestCompetitorUpdate: ev.latest_competitor_update ?? null,
      competitorsCount: ev.competitors_count ?? null,
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
      // the heavy refetch. The probe carries fresh per-stage scoring
      // progress even when `event.updated` is flat (it does not tick on
      // scorecard saves), so merge that into the cached blob first —
      // scoring_pct drives TTL/completion decisions for every consumer.
      probeOutcome = "skip";
      await recordProbeOutcome(match.ct, match.id, false);
      await mergeProbeScoringIntoMatchEntry(cacheKey, ev.stages ?? null, ttlSeconds);
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
    await recordProbeOutcome(match.ct, match.id, true);

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
 * Merge fresh per-stage scoring_progress from the sync probe into a cached
 * GetMatch entry, preserving `cachedAt` (the last-full-fetch timestamp that
 * the max-skip-age ceiling counts against) and the schema version. Shape is
 * unchanged — only scoring_progress values move — so no version bump.
 * Best-effort: any failure leaves the cached entry as it was.
 */
async function mergeProbeScoringIntoMatchEntry(
  cacheKey: string,
  probeStages: ProbeStageData[] | null,
  ttlSeconds: number | null,
): Promise<void> {
  if (!probeStages || probeStages.length === 0) return;
  try {
    const raw = await cache.get(cacheKey);
    if (!raw) return;
    const entry = JSON.parse(raw) as CacheEntry<{
      event?: { stages?: Array<{ id: string; scoring_progress?: { scored?: number | null; total?: number | null } | null }> } | null;
    }>;
    if (entry.v !== CACHE_SCHEMA_VERSION) return;
    const stages = entry.data?.event?.stages;
    if (!stages) return;
    const byId = new Map(probeStages.map((s) => [s.id, s.scoring_progress ?? null]));
    let touched = false;
    for (const stage of stages) {
      const fresh = byId.get(stage.id);
      if (fresh !== undefined) {
        const prev = JSON.stringify(stage.scoring_progress ?? null);
        if (prev !== JSON.stringify(fresh)) {
          stage.scoring_progress = fresh;
          touched = true;
        }
      }
    }
    if (!touched) return;
    const payload = JSON.stringify(entry);
    await cache.set(cacheKey, payload, ttlSeconds);
    if (parseMatchCacheKey(cacheKey)) {
      afterResponse(persistActiveMatchToD1(cacheKey, payload));
    }
  } catch { /* best-effort — stale scoring self-heals at the ceiling */ }
}

/**
 * Write a match-cache entry (Redis + throttled D1 mirror) from data the
 * caller fetched itself. Exposed for lib/scorecards-archive.ts, whose
 * incremental refresh assembles snapshots outside `refreshCachedQuery`.
 */
export async function writeMatchCacheEntry<T>(
  cacheKey: string,
  data: T,
  ttlSeconds: number | null,
): Promise<void> {
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
// Per-match scoring percentage is no longer fetched here. The previous
// implementation toggled a `scoring_completed @include(if: $includeScoring)`
// on/off because that aggregate scanned every scorecard server-side and
// added 10+ seconds to the worldwide browse query. SSI has since deprecated
// `scoring_completed` (always returns 0); the replacement is per-stage
// `scoring_progress`, which would multiply this query by stage count for
// the entire result set. The events list filters live matches purely on
// `status` + temporal window (see `filterLiveEvents`), so progress is no
// longer needed at the list level.
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
        visibility
        get_visibility_display
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
 *
 * Pass `options.fetcher` to override the upstream call (used by
 * `lib/scorecards-archive.ts` to refresh via the per-stage fan-out instead of
 * a single GraphQL query). The `query` and `variables` arguments are still
 * used for diagnostics / cache-key shape.
 */
export interface RefreshCachedQueryOptions<T> {
  fetcher?: () => Promise<T>;
}

export async function refreshCachedQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
  // Lock TTL must outlast the upstream GraphQL request so a slow fetch can't
  // expire its own lock and let a second refresh sneak in. GRAPHQL_TIMEOUT_MS
  // is 60s, so allow generous slack on top of that.
  lockTtlSeconds = 90,
  options: RefreshCachedQueryOptions<T> = {},
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
    const data = options.fetcher
      ? await options.fetcher()
      : await executeQuery<T>(query, variables);
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
export interface CachedExecuteQueryOptions<T> {
  /**
   * Override the upstream fetch on cache miss. When provided, the cache
   * layer skips its built-in `executeQuery(query, variables)` call and
   * uses this function instead. Used by `lib/scorecards-archive.ts` to
   * substitute a per-stage fan-out for a single GraphQL call without
   * giving up the existing Redis + D1 cache plumbing. The `query` and
   * `variables` arguments are still used for telemetry / diagnostics
   * (and for legibility of cache-miss logs).
   */
  fetcher?: () => Promise<T>;
}

export async function cachedExecuteQuery<T>(
  cacheKey: string,
  query: string,
  variables: Record<string, unknown>,
  ttlSeconds: number | null,
  options: CachedExecuteQueryOptions<T> = {},
): Promise<{ data: T; cachedAt: string | null }> {
  try {
    const raw = await cache.get(cacheKey);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      // Schema version gate: entries without a version or with an older version
      // are treated as misses. They will be overwritten on the next fetch.
      if (entry.v === CACHE_SCHEMA_VERSION) {
        if (
          cacheKey.startsWith("gql:GetMatch:") &&
          !(await isAdminRequest()) &&
          isPublicMatchData(entry.data)
        ) {
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
          if (
            cacheKey.startsWith("gql:GetMatch:") &&
            !(await isAdminRequest()) &&
            isPublicMatchData(entry.data)
          ) {
            afterResponse(db.recordMatchAccess(cacheKey).catch(() => {}));
          }
          return { data: entry.data, cachedAt: entry.cachedAt };
        }
      }
    } catch (err) {
      console.error("[cache] D1 fallback error for key:", cacheKey, err);
    }
  }

  const data = options.fetcher
    ? await options.fetcher()
    : await executeQuery<T>(query, variables);
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
  // Skip non-public matches (unlisted / organizer-published) so they never
  // surface on the popular-matches grid -- see lib/visibility.ts.
  if (
    cacheKey.startsWith("gql:GetMatch:") &&
    !(await isAdminRequest()) &&
    isPublicMatchData(data)
  ) {
    void db.recordMatchAccess(cacheKey).catch(() => {});
  }

  // Return null for cachedAt: freshly fetched, not served from cache
  return { data, cachedAt: null };
}

// ─── Shared scorecard field set ──────────────────────────────────────────────
// Interpolated into STAGE_SCORECARDS_QUERY so any future per-stage variant
// stays in sync without copy-paste drift. Exported so the archive module's
// raw response shape stays aligned with what's projected on the wire.
//
// When adding a scorecard field:
//   1. Add to SCORECARD_NODE_FIELDS (here)
//   2. Add to RawScCard (lib/scorecard-data.ts)
//   3. Bump CACHE_SCHEMA_VERSION (lib/constants.ts)
//   4. Run `pnpm check:ssi-schema --update` and commit the snapshot diff
export const SCORECARD_NODE_FIELDS = `
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

// ─── Query: per-stage scorecards (the only scorecards path) ──────────────────
// SSI's blessed path: fetch one stage at a time via the root
// `stage(content_type, id)` query. The whole-match
// `event { stages { scorecards } }` shape was deprecated by SSI on
// 2026-05-04 and removed from this codebase along with the parallel
// "incremental delta" path that targeted it.
//
// Compared to the deprecated whole-match query, the per-stage fan-out
// (orchestrated in `lib/scorecards-archive.ts`) is empirically 2-5× faster
// on cold loads for completed matches because SSI parallelizes 8-10 small
// per-stage queries instead of one big blocking one (verified against
// matches 26193, 27046, 27704 on 2026-05-04).
//
// Variables:
//   $ct  - IpscStageNode content_type (24)
//   $id  - the stage's primary key (NOT the match's id)
//
// Returns `scorecards: []` for matches whose
// `IpscMatchNode.is_live_scores_accessible` is false during scoring; the
// short-circuit in compare/route.ts and stages/route.ts avoids reaching this
// query in that case.
export const STAGE_SCORECARDS_QUERY = `
  query GetStageScorecards($ct: Int!, $id: String!) {
    stage(content_type: $ct, id: $id) {
      id
      number
      name
      ... on IpscStageNode {
        max_points
        scorecards {
          ${SCORECARD_NODE_FIELDS}
        }
      }
    }
  }
`;

// ─── Query: per-stage scorecards DELTA (flagged; SSI ask #3 2026-08-15) ──────
// Same shape as STAGE_SCORECARDS_QUERY but filters server-side to cards whose
// `updated` is after the watermark — the previous sync cycle's
// `IpscStageNode.latest_scorecard_update` from the probe sidecar, minus a 3s
// overlap, sent as UTC-Z. The extra `... on IpscScoreCardNode { updated }`
// fragment is response-only (merged then stripped before caching), so the
// cached shape — and therefore CACHE_SCHEMA_VERSION — is unchanged.
//
// Enabled via SCORECARDS_DELTA_ENABLED=on. SSI confirmed semantics
// 2026-08-18 (new cards get created==updated at creation, so the watermark
// catches both creates and edits); UTC-Z parsing and filtering verified
// against the live API 2026-08-19. While off, changed stages are refetched
// whole (still only the CHANGED stages).
export const STAGE_SCORECARDS_DELTA_QUERY = `
  query GetStageScorecardsDelta($ct: Int!, $id: String!, $updatedAfter: String!) {
    stage(content_type: $ct, id: $id) {
      id
      number
      name
      ... on IpscStageNode {
        max_points
        scorecards(updated_after: $updatedAfter) {
          ${SCORECARD_NODE_FIELDS}
          ... on IpscScoreCardNode {
            updated
          }
        }
      }
    }
  }
`;
