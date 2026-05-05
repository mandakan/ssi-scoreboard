// Server-only — post-match scorecards archive via SSI's per-stage root query.
//
// Why a separate module:
//   SSI deprecated the whole-match `event { stages { scorecards } }` path on
//   2026-05-04 (see lib/graphql.ts:SCORECARDS_QUERY). The new SSI-blessed path
//   is `stage(content_type, id) { scorecards }`, fetched per stage. We
//   parallel-fetch all stages for a match and reassemble them into the same
//   `RawScorecardsData` shape downstream parsers consume — no caller-side
//   refactor needed.
//
// Cold-load latency vs the deprecated path (matches 26193, 27046, 27704,
// measured 2026-05-04):
//   legacy whole-match:           8-17s wall-clock
//   per-stage parallel fan-out:   2.6-3.5s wall-clock
//
// **Post-match only.** Live matches return `scorecards: []` from every API
// path (results=org gate is on the match's visibility setting, not the query
// shape). Callers MUST check `isMatchCompleteFromEvent` before calling into
// this module, otherwise the archive would be cached as empty and never
// refresh once the match flips to results=all.

import {
  cachedExecuteQuery,
  executeQuery,
  gqlCacheKey,
  STAGE_SCORECARDS_QUERY,
} from "@/lib/graphql";
import type {
  RawScorecardsData,
  RawStage,
  RawScCard,
} from "@/lib/scorecard-data";

// ─── Raw response shape ──────────────────────────────────────────────────────

interface SingleStageResponse {
  stage: {
    id: string;
    number: number;
    name: string;
    max_points?: number | null;
    scorecards?: RawScCard[];
  } | null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Identifies a stage to fetch via the root `stage(ct, id)` query. */
export interface StageRef {
  /** IpscStageNode content_type (always 24 for IPSC). */
  ct: number;
  /** Stage primary key as a string (SSI's id type). */
  id: string;
}

/**
 * Permanent-cache wrapper around the per-stage archival fetch.
 *
 * On cache hit returns the assembled `RawScorecardsData` directly. On miss,
 * fan-outs across `stages` (concurrency-limited), reassembles into the legacy
 * shape, and writes the entry with `ttl=null` (permanent). Subsequent reads
 * are pure cache hits.
 *
 * The cache key intentionally matches the legacy SCORECARDS_QUERY key
 * (`gql:GetMatchScorecards:{...}`) so existing match-cache infrastructure
 * (D1 mirror via `match_data_cache`, force-refresh sentinel, etc.) keeps
 * working without churn. Callers don't see a difference.
 */
export async function cachedWholeMatchArchive(
  matchCt: number,
  matchId: string,
  stages: StageRef[],
): Promise<{ data: RawScorecardsData; cachedAt: string | null }> {
  const cacheKey = gqlCacheKey("GetMatchScorecards", { ct: matchCt, id: matchId });
  return cachedExecuteQuery<RawScorecardsData>(
    cacheKey,
    // The query string is a no-op for the cache layer (it's the cache value
    // we care about), but `cachedExecuteQuery` will use it on a cache miss
    // for diagnostics/telemetry. Hand it the per-stage query as a hint of
    // what shape lives behind this key. If the cache misses, our custom
    // fetcher below replaces the would-be GraphQL call.
    STAGE_SCORECARDS_QUERY,
    { ct: matchCt, id: matchId },
    null,
    {
      // Override the upstream fetcher: instead of executing
      // STAGE_SCORECARDS_QUERY once with the match's (ct, id) — which would
      // be wrong, those args belong to the stage — fan out per-stage and
      // assemble.
      fetcher: () => fetchWholeMatchArchive(stages),
    },
  );
}

/**
 * Uncached parallel per-stage fetch + assembly. Use this only when you
 * intentionally want to bypass the cache (e.g. force-refresh path). Most
 * callers should use `cachedWholeMatchArchive` instead.
 */
export async function fetchWholeMatchArchive(
  stages: StageRef[],
): Promise<RawScorecardsData> {
  if (stages.length === 0) {
    return { event: { stages: [] } };
  }
  const responses = await mapWithConcurrency(stages, MAX_CONCURRENCY, (s) =>
    executeQuery<SingleStageResponse>(STAGE_SCORECARDS_QUERY, { ct: s.ct, id: s.id }),
  );
  const out: RawStage[] = [];
  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r?.stage) continue;
    out.push({
      id: r.stage.id,
      number: r.stage.number,
      name: r.stage.name,
      max_points: r.stage.max_points ?? null,
      scorecards: r.stage.scorecards ?? [],
    });
  }
  // Sort by stage number so downstream consumers see the same ordering as
  // the legacy whole-match query.
  out.sort((a, b) => a.number - b.number);
  return { event: { stages: out } };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Concurrency cap for the per-stage fan-out. SSI's 2026-05-04 admin message
 * flagged "many seconds" as a sign of inefficiency; per-stage queries
 * empirically take 1-2s each so a 4-in-flight cap keeps a 10-stage match's
 * total wall-clock under ~5s while never having more than 4 outstanding
 * upstream connections.
 */
const MAX_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, items.length);
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
