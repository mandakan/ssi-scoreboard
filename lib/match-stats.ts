// Pure functions for per-match shooter statistics. No I/O, fully unit-tested.

import type { RawScorecard } from "@/app/api/compare/logic";

export interface MatchStats {
  stageCount: number;
  avgHF: number | null;
  matchPct: number | null;
  totalA: number;
  totalC: number;
  totalD: number;
  totalMiss: number;
  totalNoShoots: number;
  totalProcedurals: number;
  dq: boolean;
  perfectStages: number;
  consistencyIndex: number | null;
}

/**
 * Compute per-match summary for one shooter from raw scorecard data.
 *
 * `matchPct` mirrors the official IPSC formula used by ShootNScoreIt:
 *
 *   stage_points = (competitor_HF / division_stage_winner_HF) × stage.max_points
 *   match_points = sum over all valid stages
 *   matchPct     = (my_match_points / division_leader_match_points) × 100
 *
 * Stage length matters (longer stages are worth more points), which matches
 * the rank/percentage shown on shootnscoreit.com.
 *
 * Falls back to a simple average-of-stage-percentages when stage `max_points`
 * is missing on any of the shooter's stages — keeps older cache entries
 * (written before stage `max_points` was captured) usable.
 */
export function computeMatchStats(
  competitorId: number,
  division: string | null,
  rawScorecards: RawScorecard[],
): MatchStats {
  const myCards = rawScorecards.filter(
    (sc) =>
      sc.competitor_id === competitorId &&
      !sc.dnf &&
      !sc.dq &&
      !sc.zeroed &&
      sc.hit_factor != null &&
      sc.hit_factor >= 0,
  );

  const stageCount = myCards.length;
  if (stageCount === 0) {
    return {
      stageCount: 0,
      avgHF: null,
      matchPct: null,
      totalA: 0,
      totalC: 0,
      totalD: 0,
      totalMiss: 0,
      totalNoShoots: 0,
      totalProcedurals: 0,
      dq: rawScorecards.some(
        (sc) => sc.competitor_id === competitorId && sc.dq,
      ),
      perfectStages: 0,
      consistencyIndex: null,
    };
  }

  const hfSum = myCards.reduce((s, sc) => s + (sc.hit_factor ?? 0), 0);
  const avgHF = hfSum / stageCount;

  // Consistency index: (1 - CV) * 100 where CV = stddev(stageHFs) / mean(stageHFs)
  let consistencyIndex: number | null = null;
  const hfs = myCards
    .map((sc) => sc.hit_factor ?? 0)
    .filter((hf) => hf > 0);
  if (hfs.length >= 2) {
    const mean = hfs.reduce((s, v) => s + v, 0) / hfs.length;
    if (mean > 0) {
      const variance =
        hfs.reduce((s, v) => s + (v - mean) ** 2, 0) / hfs.length;
      consistencyIndex = (1 - Math.sqrt(variance) / mean) * 100;
    }
  }

  const matchPct = computeMatchPercent(competitorId, division, rawScorecards, myCards);

  // Hit-zone totals
  const totalA = myCards.reduce((s, sc) => s + (sc.a_hits ?? 0), 0);
  const totalC = myCards.reduce((s, sc) => s + (sc.c_hits ?? 0), 0);
  const totalD = myCards.reduce((s, sc) => s + (sc.d_hits ?? 0), 0);
  const totalMiss = myCards.reduce((s, sc) => s + (sc.miss_count ?? 0), 0);
  const totalNoShoots = myCards.reduce((s, sc) => s + (sc.no_shoots ?? 0), 0);
  const totalProcedurals = myCards.reduce((s, sc) => s + (sc.procedurals ?? 0), 0);
  const dq = rawScorecards.some(
    (sc) => sc.competitor_id === competitorId && sc.dq,
  );

  // Perfect stages: all A-hits, no C/D/miss/no-shoot/procedural, and at least one A-hit
  const perfectStages = myCards.filter(
    (sc) =>
      (sc.a_hits ?? 0) > 0 &&
      (sc.c_hits ?? 0) === 0 &&
      (sc.d_hits ?? 0) === 0 &&
      (sc.miss_count ?? 0) === 0 &&
      (sc.no_shoots ?? 0) === 0 &&
      (sc.procedurals ?? 0) === 0,
  ).length;

  return {
    stageCount,
    avgHF,
    matchPct,
    totalA,
    totalC,
    totalD,
    totalMiss,
    totalNoShoots,
    totalProcedurals,
    dq,
    perfectStages,
    consistencyIndex,
  };
}

function computeMatchPercent(
  competitorId: number,
  division: string | null,
  rawScorecards: RawScorecard[],
  myCards: RawScorecard[],
): number | null {
  if (!division || myCards.length === 0) return null;

  // If any of the shooter's stages is missing max_points (older cache entries),
  // we cannot compute IPSC points — fall back to the simple average.
  const hasMaxPoints = myCards.every(
    (sc) => sc.max_points != null && sc.max_points > 0,
  );
  if (!hasMaxPoints) return averageStagePercent(division, rawScorecards, myCards);

  // Per-stage division winner HF (excludes DNF/DQ/zeroed and zero-HF cards).
  const stageWinnerHF = new Map<number, number>();
  for (const sc of rawScorecards) {
    if (sc.competitor_division !== division) continue;
    if (sc.dnf || sc.dq || sc.zeroed) continue;
    if (sc.hit_factor == null || sc.hit_factor <= 0) continue;
    const cur = stageWinnerHF.get(sc.stage_id) ?? 0;
    if (sc.hit_factor > cur) stageWinnerHF.set(sc.stage_id, sc.hit_factor);
  }

  // Sum match points per division competitor.
  // A competitor with any DQ scorecard is excluded from the leader pool
  // (a stage DQ = whole-match DQ in IPSC).
  const matchPoints = new Map<number, number>();
  const dqCompetitors = new Set<number>();
  for (const sc of rawScorecards) {
    if (sc.competitor_division !== division) continue;
    if (sc.dq) dqCompetitors.add(sc.competitor_id);
    if (sc.dnf || sc.dq || sc.zeroed) continue;
    if (sc.hit_factor == null || sc.hit_factor <= 0) continue;
    if (sc.max_points == null || sc.max_points <= 0) continue;
    const winner = stageWinnerHF.get(sc.stage_id) ?? 0;
    if (winner <= 0) continue;
    const pts = (sc.hit_factor / winner) * sc.max_points;
    matchPoints.set(
      sc.competitor_id,
      (matchPoints.get(sc.competitor_id) ?? 0) + pts,
    );
  }

  let leaderPoints = 0;
  for (const [compId, pts] of matchPoints) {
    if (dqCompetitors.has(compId)) continue;
    if (pts > leaderPoints) leaderPoints = pts;
  }

  const myPoints = matchPoints.get(competitorId) ?? 0;
  if (leaderPoints <= 0 || myPoints <= 0) return null;
  return (myPoints / leaderPoints) * 100;
}

function averageStagePercent(
  division: string,
  rawScorecards: RawScorecard[],
  myCards: RawScorecard[],
): number | null {
  const stagePcts: number[] = [];
  for (const card of myCards) {
    const divCards = rawScorecards.filter(
      (sc) =>
        sc.stage_id === card.stage_id &&
        !sc.dnf &&
        !sc.dq &&
        !sc.zeroed &&
        sc.hit_factor != null &&
        sc.competitor_division === division,
    );
    const leaderHF = divCards.reduce(
      (max, sc) => Math.max(max, sc.hit_factor ?? 0),
      0,
    );
    if (leaderHF > 0 && card.hit_factor != null) {
      stagePcts.push((card.hit_factor / leaderHF) * 100);
    }
  }
  return stagePcts.length > 0
    ? stagePcts.reduce((a, b) => a + b, 0) / stagePcts.length
    : null;
}
