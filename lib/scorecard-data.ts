// Server-only: this module imports from lib/graphql (server-only).
// Do not import from client components or files with "use client".

import type { RawScorecard } from "@/app/api/compare/logic";

// ─── Raw GraphQL response shapes ─────────────────────────────────────────────

export interface RawScCard {
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
    handgun_div?: string | null;
    get_handgun_div_display?: string | null;
  } | null;
}

export interface RawStage {
  id: string;
  number: number;
  name: string;
  max_points?: number | null; // from ... on IpscStageNode fragment
  scorecards?: RawScCard[];
}

export interface RawScorecardsData {
  event: {
    stages?: RawStage[];
  } | null;
}

// ─── Shared parse function ────────────────────────────────────────────────────

/**
 * Parse a raw GraphQL scorecard response into normalised RawScorecard[].
 * B-zone and C-zone hits are combined into a single c_hits field.
 *
 * This is the canonical parsing step shared by the compare route and the OG
 * image route. Both call cachedExecuteQuery(SCORECARDS_QUERY) themselves (they
 * have different TTL management), then delegate here for the parse step.
 */
export function parseRawScorecards(data: RawScorecardsData): RawScorecard[] {
  const rawScorecards: RawScorecard[] = [];

  for (const stage of data.event?.stages ?? []) {
    const stageId = parseInt(stage.id, 10);

    for (const sc of stage.scorecards ?? []) {
      if (!sc.competitor) continue;
      const compId = parseInt(sc.competitor.id, 10);

      const parseNum = (v: number | string | null | undefined) =>
        v != null ? parseFloat(String(v)) : null;

      const b = parseNum(sc.bscore);
      const c = parseNum(sc.cscore);
      rawScorecards.push({
        competitor_id: compId,
        competitor_division:
          sc.competitor.get_handgun_div_display ?? sc.competitor.handgun_div ?? null,
        stage_id: stageId,
        stage_number: stage.number,
        stage_name: stage.name,
        max_points: stage.max_points ?? 0,
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
  }

  return rawScorecards;
}
