// Server-only — fetches per-competitor scorecard data via SSI's
// `competitor_scorecards()` and `competitor_scorecards_count()` root queries
// (added 2026-05-04 alongside SSI's deprecation of the whole-match
// `event { stages { scorecards } }` path).
//
// This module exists so live views can fetch ONLY the competitors a user
// has selected, instead of pulling every scorecard for every competitor in
// a match. See #410 for the redesign rationale.
//
// Cache strategy: Redis-only, keyed per (competitor_ct, competitor_id). No
// D1 mirror — entries are small enough that re-fetching from upstream after
// a Redis eviction is acceptable. If we ever need durability for these
// (e.g. for shooter-dashboard offline reads), add a sibling table.

import {
  cachedExecuteQuery,
  executeQuery,
  gqlCacheKey,
  SCORECARD_NODE_FIELDS,
} from "@/lib/graphql";
import type { RawScorecard } from "@/app/api/compare/logic";

// ─── Queries ─────────────────────────────────────────────────────────────────

// Fetches every scorecard for a single competitor across every stage of every
// match they have appeared in. Returns a flat list (not nested by stage).
//
// Each scorecard carries its own `stage` reference so the caller can rebucket
// per stage if needed. The `competitor` block is redundant for per-competitor
// queries (we already know whose data this is) but is preserved so the same
// `parseRawScorecards`-shaped output can be produced without forking the
// downstream parser.
export const COMPETITOR_SCORECARDS_QUERY = `
  query GetCompetitorScorecards($ct: Int!, $id: String!) {
    competitor_scorecards(content_type: $ct, id: $id) {
      ... on IpscScoreCardNode {
        stage {
          id
          number
          name
          ... on IpscStageNode {
            max_points
          }
        }
      }
      ${SCORECARD_NODE_FIELDS}
    }
  }
`;

// Tiny probe query — returns just the scalar count. Used to detect changes
// before triggering a full per-competitor refetch (planned in PR-E).
export const COMPETITOR_SCORECARDS_COUNT_QUERY = `
  query GetCompetitorScorecardsCount($ct: Int!, $id: String!) {
    competitor_scorecards_count(content_type: $ct, id: $id)
  }
`;

// ─── Raw response shapes ─────────────────────────────────────────────────────

interface RawCompetitorScCard {
  stage?: {
    id: string;
    number: number;
    name: string;
    max_points?: number | null;
  } | null;
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
    get_division_display?: string | null;
    handgun_div?: string | null;
    get_handgun_div_display?: string | null;
  } | null;
}

export interface CompetitorScorecardsData {
  competitor_scorecards: RawCompetitorScCard[];
}

export interface CompetitorScorecardsCountData {
  competitor_scorecards_count: number;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a per-competitor GraphQL response into RawScorecard[] (the same flat
 * shape `parseRawScorecards()` produces from the whole-match query). Filters
 * to the requested competitor id so multi-match noise from the upstream
 * response (a single shooter usually competes in many matches) is dropped
 * before we try to use it for a single-match comparison.
 *
 * `matchStageIds` is the set of stage ids that belong to the match currently
 * being rendered. Scorecards from other matches (e.g. earlier events the
 * shooter competed in) will not have stage ids in this set and are filtered
 * out.
 */
export function parseCompetitorScorecards(
  data: CompetitorScorecardsData,
  competitorId: number,
  matchStageIds: Set<number>,
): RawScorecard[] {
  const out: RawScorecard[] = [];
  const parseNum = (v: number | string | null | undefined): number | null =>
    v != null ? parseFloat(String(v)) : null;

  for (const sc of data.competitor_scorecards ?? []) {
    if (!sc.stage || !sc.competitor) continue;

    const stageId = parseInt(sc.stage.id, 10);
    if (!matchStageIds.has(stageId)) continue;

    const compId = parseInt(sc.competitor.id, 10);
    if (compId !== competitorId) continue;

    const b = parseNum(sc.bscore);
    const c = parseNum(sc.cscore);
    out.push({
      competitor_id: compId,
      competitor_division:
        sc.competitor.get_division_display ||
        sc.competitor.get_handgun_div_display ||
        sc.competitor.handgun_div ||
        null,
      stage_id: stageId,
      stage_number: sc.stage.number,
      stage_name: sc.stage.name,
      max_points: sc.stage.max_points ?? 0,
      points: parseNum(sc.points),
      hit_factor: parseNum(sc.hitfactor),
      time: parseNum(sc.time),
      dq: sc.disqualified ?? false,
      zeroed: sc.zeroed ?? false,
      dnf: sc.stage_not_fired ?? false,
      incomplete: sc.incomplete ?? false,
      a_hits: parseNum(sc.ascore),
      c_hits: b !== null || c !== null ? (b ?? 0) + (c ?? 0) : null,
      d_hits: parseNum(sc.dscore),
      miss_count: parseNum(sc.miss),
      no_shoots: parseNum(sc.penalty),
      procedurals: parseNum(sc.procedural),
      scorecard_created: sc.created ?? null,
    });
  }

  return out;
}

// ─── Cache wrappers ──────────────────────────────────────────────────────────

/**
 * Cached fetch of one competitor's scorecards. Same TTL semantics as
 * `cachedExecuteQuery` for the match-overview key — caller decides how long
 * the entry stays in Redis.
 *
 * Cache key is keyed on the **competitor's** (ct, id), not the match's. A
 * single shooter's scorecards are global-ish (cover all matches they have
 * shot) so a per-competitor cache is shared across all matches that need
 * data for that shooter. The match-stage-id filter applied during parsing
 * scopes the response to one match at the consumer side.
 */
export async function cachedCompetitorScorecards(
  competitorCt: number,
  competitorId: string,
  ttlSeconds: number | null,
): Promise<{ data: CompetitorScorecardsData; cachedAt: string | null }> {
  const cacheKey = gqlCacheKey("GetCompetitorScorecards", {
    ct: competitorCt,
    id: competitorId,
  });
  return cachedExecuteQuery<CompetitorScorecardsData>(
    cacheKey,
    COMPETITOR_SCORECARDS_QUERY,
    { ct: competitorCt, id: competitorId },
    ttlSeconds,
  );
}

/**
 * Uncached fan-out probe for a single competitor's scorecards count.
 *
 * Not currently called from any runtime path — added now so PR-E (cadence
 * tiering / SWR per-competitor) has a ready hook. Each call is one tiny
 * round-trip; SWR-style usage will batch these per match-tab.
 */
export async function fetchCompetitorScorecardsCount(
  competitorCt: number,
  competitorId: string,
): Promise<number> {
  const data = await executeQuery<CompetitorScorecardsCountData>(
    COMPETITOR_SCORECARDS_COUNT_QUERY,
    { ct: competitorCt, id: competitorId },
  );
  return data.competitor_scorecards_count ?? 0;
}

/**
 * Fan-out helper: fetch scorecards for several competitors in parallel and
 * concatenate into a single flat `RawScorecard[]`. Each input ref is the
 * **competitor's** (ct, id) — different from the match's (ct, id) — together
 * with the numeric competitor id used for filtering during parsing.
 *
 * `matchStageIds` is the set of stage ids belonging to the match currently
 * being rendered, used to drop cross-match noise from each per-competitor
 * response (shooters typically have scorecards across many matches).
 *
 * Failures on a single competitor cause the whole helper to reject — caller
 * decides how to surface that. We don't return partial results because the
 * downstream rendering paths assume each requested competitor either has
 * data or is an explicit miss; silently dropping one looks like the
 * shooter has no scorecards.
 */
export interface SelectedCompetitorRef {
  /** Competitor's content_type (e.g. IpscCompetitorNode key). NOT the match's ct. */
  ct: number;
  /** Competitor id as a string (SSI's id type). */
  id: string;
  /** Same id as a number — used to filter the per-competitor response. */
  numericId: number;
}

export async function fetchSelectedCompetitorsScorecards(
  refs: SelectedCompetitorRef[],
  matchStageIds: Set<number>,
  ttlSeconds: number | null,
): Promise<{ scorecards: RawScorecard[]; cachedAts: (string | null)[] }> {
  const responses = await Promise.all(
    refs.map((ref) => cachedCompetitorScorecards(ref.ct, ref.id, ttlSeconds)),
  );
  const scorecards: RawScorecard[] = [];
  const cachedAts: (string | null)[] = [];
  for (let i = 0; i < refs.length; i++) {
    cachedAts.push(responses[i].cachedAt);
    scorecards.push(
      ...parseCompetitorScorecards(
        responses[i].data,
        refs[i].numericId,
        matchStageIds,
      ),
    );
  }
  return { scorecards, cachedAts };
}
