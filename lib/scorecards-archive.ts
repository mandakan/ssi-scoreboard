// Server-only — match-scorecards fetch via SSI's per-stage root query.
//
// SSI deprecated the whole-match `event { stages { scorecards } }` path on
// 2026-05-04. The blessed replacement is `stage(content_type, id) { scorecards }`,
// fetched per stage. We parallel-fetch all stages for a match and reassemble
// them into the `RawScorecardsData` shape downstream parsers consume — no
// caller-side refactor needed.
//
// Cold-load latency vs the deprecated whole-match path (matches 26193, 27046,
// 27704, measured 2026-05-04):
//   legacy whole-match:           8-17s wall-clock
//   per-stage parallel fan-out:   2.6-3.5s wall-clock
//
// `getMatchScorecards` is the single read path used by both the post-match
// archive (permanent cache, ttl=null) and the live courtside view (TTL'd
// cache + stale-while-revalidate refresh). The cache key matches the legacy
// `gql:GetMatchScorecards:{...}` shape so existing infrastructure (D1 mirror,
// force-refresh sentinel, popular-match indexer) keeps working.

import { afterResponse } from "@/lib/background-impl";
import {
  cachedExecuteQuery,
  executeQuery,
  gqlCacheKey,
  refreshCachedMatchQuery,
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

export interface GetMatchScorecardsArgs {
  /** IpscMatchNode content_type (22 for all IPSC disciplines). */
  ct: number;
  /** Match primary key as a string. */
  matchId: string;
  /** Stages to fan-out across on a cache miss. */
  stages: StageRef[];
  /**
   * Cache TTL (seconds). `null` = permanent — use for completed matches.
   * A positive number caps freshness during live matches; the SWR refresh
   * below keeps the cache warm within that window.
   */
  ttlSeconds: number | null;
  /**
   * Optional stale-while-revalidate window (seconds). When the cached entry
   * is older than this, an in-flight refresh is scheduled (single-flighted
   * via Redis NX lock) using the same per-stage fan-out. Ignored when
   * `ttlSeconds` is null (permanent entries don't refresh).
   */
  freshnessSeconds?: number | null;
}

/**
 * Read-or-fetch match scorecards. Single entry point for both post-match
 * (permanent cache) and live (TTL + SWR) modes — the only difference is the
 * `ttlSeconds` / `freshnessSeconds` pair.
 */
export async function getMatchScorecards(
  args: GetMatchScorecardsArgs,
): Promise<{ data: RawScorecardsData; cachedAt: string | null }> {
  const { ct, matchId, stages, ttlSeconds, freshnessSeconds } = args;
  const cacheKey = gqlCacheKey("GetMatchScorecards", { ct, id: matchId });
  const variables = { ct, id: matchId };

  const result = await cachedExecuteQuery<RawScorecardsData>(
    cacheKey,
    // STAGE_SCORECARDS_QUERY is passed for diagnostics / cache-key shape; the
    // fetcher below replaces the actual upstream call (the single-stage
    // variables would be wrong otherwise).
    STAGE_SCORECARDS_QUERY,
    variables,
    ttlSeconds,
    { fetcher: () => fetchWholeMatchArchive(stages) },
  );

  // SWR: when the cached entry is older than freshnessSeconds, kick off a
  // single-flighted background refresh using the same per-stage fan-out.
  // Permanent entries (ttl=null) don't refresh — completed matches are
  // immutable.
  if (
    result.cachedAt !== null &&
    ttlSeconds !== null &&
    freshnessSeconds != null
  ) {
    const ageSeconds =
      (Date.now() - new Date(result.cachedAt).getTime()) / 1000;
    if (ageSeconds > freshnessSeconds) {
      afterResponse(
        refreshCachedMatchQuery<RawScorecardsData>(
          cacheKey,
          STAGE_SCORECARDS_QUERY,
          variables,
          ttlSeconds,
          { ct, id: matchId },
          90,
          { fetcher: () => fetchWholeMatchArchive(stages) },
        ),
      );
    }
  }

  return result;
}

/**
 * Uncached parallel per-stage fetch + assembly. Use only when you need to
 * bypass the cache (e.g. the cache layer's miss path); most callers should
 * use `getMatchScorecards` instead.
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
