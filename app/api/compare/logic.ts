// Pure function — no I/O, no side effects. Fully unit-tested.
// Extracted from compare/route.ts to keep it separately testable.

import type {
  StageComparison,
  CompetitorSummary,
  CompetitorInfo,
  CompetitorPenaltyStats,
  EfficiencyStats,
  ConsistencyStats,
  StageClassification,
} from "@/lib/types";

export interface RawScorecard {
  competitor_id: number;
  competitor_division: string | null; // handgun_div from IpscCompetitorNode
  stage_id: number;
  stage_number: number;
  stage_name: string;
  max_points: number;
  points: number | null;
  hit_factor: number | null;
  time: number | null;
  dq: boolean;
  zeroed: boolean;
  dnf: boolean;
  incomplete: boolean;
  a_hits: number | null;
  c_hits: number | null; // B-zone combined into C
  d_hits: number | null;
  miss_count: number | null;
  no_shoots: number | null;
  procedurals: number | null;
  // ISO datetime string from the API — used to derive per-competitor shooting order
  scorecard_created?: string | null;
}

/**
 * Effective hit factor for ranking purposes:
 *   - DNF → null  (excluded from rankings)
 *   - DQ / zeroed → 0  (ranked last)
 *   - Valid → actual hit_factor (may itself be null if not yet computed by API)
 */
function effectiveHF(sc: RawScorecard): number | null {
  if (sc.dnf) return null;
  if (sc.dq || sc.zeroed) return 0;
  return sc.hit_factor ?? 0;
}

/**
 * Rank a set of scorecards by hit factor descending.
 * Returns a rank map (competitor_id → rank) and the leader's HF.
 * DNF competitors are excluded. DQ/zeroed are treated as HF=0.
 * Ties share the same rank; the next rank skips accordingly.
 */
function rankByHF(scorecards: RawScorecard[]): {
  rankMap: Map<number, number>;
  leaderHF: number | null;
} {
  const fired = scorecards.filter((sc) => !sc.dnf);

  const sorted = [...fired].sort((a, b) => {
    return (effectiveHF(b) ?? 0) - (effectiveHF(a) ?? 0);
  });

  const rankMap = new Map<number, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prevHF = effectiveHF(sorted[i - 1]) ?? 0;
      const currHF = effectiveHF(sorted[i]) ?? 0;
      if (currHF < prevHF) currentRank = i + 1;
    }
    rankMap.set(sorted[i].competitor_id, currentRank);
  }

  const validHFs = fired
    .map((sc) => effectiveHF(sc) ?? 0)
    .filter((hf) => hf > 0);
  const leaderHF = validHFs.length > 0 ? Math.max(...validHFs) : null;

  return { rankMap, leaderHF };
}

function pct(hf: number | null, leaderHF: number | null): number | null {
  if (hf == null || leaderHF == null || leaderHF === 0) return null;
  return (hf / leaderHF) * 100;
}

/**
 * Compute percentile placement for a competitor within a ranked field.
 *   percentile = 1 − (rank − 1) / (N − 1)
 * where rank is 1-indexed (1 = best) and N = total ranked (non-DNF) competitors.
 *
 * Edge cases:
 *   - rank null → null (DNF)
 *   - N = 0    → null (no competitors)
 *   - N = 1    → 1.0  (sole competitor, by definition P100)
 */
export function computePercentile(rank: number | null, n: number): number | null {
  if (rank === null || n === 0) return null;
  if (n === 1) return 1.0;
  return 1 - (rank - 1) / (n - 1);
}

/**
 * Compute the median HF for a set of scorecards.
 * Excludes DNF, DQ, and zeroed scorecards, and entries with null hit_factor.
 * Returns the median and the count of valid competitors included.
 */
function medianHF(scorecards: RawScorecard[]): { median: number | null; count: number } {
  const valid = scorecards
    .filter((sc) => !sc.dnf && !sc.dq && !sc.zeroed)
    .map((sc) => sc.hit_factor)
    .filter((hf): hf is number => hf != null);

  if (valid.length === 0) return { median: null, count: 0 };

  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  return { median, count: valid.length };
}

const DIFFICULTY_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "easy",
  2: "moderate",
  3: "hard",
  4: "very hard",
  5: "brutal",
};

/**
 * Thresholds used for per-stage run classification.
 * Centralised here so they can be adjusted without hunting through logic code.
 */
export const STAGE_CLASS_THRESHOLDS = {
  SOLID_HF_PCT: 95,           // HF% ≥ this → eligible for Solid
  CONSERVATIVE_HF_PCT_MIN: 85, // HF% ≥ this (and < SOLID) → eligible for Conservative
  CONSERVATIVE_A_PCT: 90,     // A% must be > this for Conservative
  OVERPUSH_HF_PCT: 85,        // HF% < this → eligible for Over-push
  OVERPUSH_A_PCT: 85,         // A% must be < this for Over-push
  MELTDOWN_HF_PCT: 70,        // HF% < this → Meltdown (any penalty count)
  MELTDOWN_MISS_NS: 2,        // miss + no-shoot ≥ this → Meltdown
} as const;

/**
 * Classify a single stage run into one of four quality buckets.
 *
 * Priority (highest to lowest):
 *   1. Meltdown — catastrophic: HF% < 70 %, ≥ 2 misses/NS, or any procedural
 *   2. Solid    — excellent: HF% ≥ 95 %, penalty-free
 *   3. Conservative — decent: HF% 85–95 %, penalty-free, A% > 90 %
 *   4. Over-push — risky: HF% < 85 %, penalised, A% < 85 %
 *   null — does not fit any bucket (edge cases, or groupPercent is unknown)
 *
 * @param groupPercent HF as % of the group leader on this stage (already computed)
 * @param aHits        A-zone hits (null if not recorded)
 * @param cHits        C/B-zone hits (null if not recorded)
 * @param dHits        D-zone hits (null if not recorded)
 * @param missCount    Miss count (null if not recorded)
 * @param noShoots     No-shoot penalties (null if not recorded)
 * @param procedurals  Procedural penalties (null if not recorded)
 */
export function classifyStageRun(
  groupPercent: number | null,
  aHits: number | null,
  cHits: number | null,
  dHits: number | null,
  missCount: number | null,
  noShoots: number | null,
  procedurals: number | null
): StageClassification | null {
  if (groupPercent === null) return null;

  const a = aHits ?? 0;
  const c = cHits ?? 0;
  const d = dHits ?? 0;
  const miss = missCount ?? 0;
  const ns = noShoots ?? 0;
  const proc = procedurals ?? 0;
  const penalized = miss > 0 || ns > 0 || proc > 0;

  const totalHits = a + c + d + miss;
  const aPct = totalHits > 0 ? (a / totalHits) * 100 : null;

  // 1. Meltdown (checked first — takes priority over all other buckets)
  if (
    groupPercent < STAGE_CLASS_THRESHOLDS.MELTDOWN_HF_PCT ||
    miss + ns >= STAGE_CLASS_THRESHOLDS.MELTDOWN_MISS_NS ||
    proc > 0
  ) {
    return "meltdown";
  }

  // 2. Solid: fast and clean
  if (groupPercent >= STAGE_CLASS_THRESHOLDS.SOLID_HF_PCT && !penalized) {
    return "solid";
  }

  // 3. Conservative: decent pace, penalty-free, high accuracy
  if (
    groupPercent >= STAGE_CLASS_THRESHOLDS.CONSERVATIVE_HF_PCT_MIN &&
    !penalized &&
    (aPct === null || aPct > STAGE_CLASS_THRESHOLDS.CONSERVATIVE_A_PCT)
  ) {
    return "conservative";
  }

  // 4. Over-push: pushed speed, paid penalty cost, accuracy suffered
  if (
    groupPercent < STAGE_CLASS_THRESHOLDS.OVERPUSH_HF_PCT &&
    penalized &&
    (aPct === null || aPct < STAGE_CLASS_THRESHOLDS.OVERPUSH_A_PCT)
  ) {
    return "over-push";
  }

  return null;
}

/**
 * Map a normalised difficulty score [0, 1] to a 1–5 integer level.
 * 0 = easiest (highest field median HF), 1 = hardest (lowest field median HF).
 */
function normalisedToLevel(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score < 0.2) return 1;
  if (score < 0.4) return 2;
  if (score < 0.6) return 3;
  if (score < 0.8) return 4;
  return 5;
}

/**
 * Assign difficulty levels to a set of stages based on their field median HFs.
 *
 * Formula: difficulty[s] = 1 − (field_median_hf[s] / max(field_median_hf[]))
 * Stages with a higher field median are easier (more shooters score well).
 *
 * Edge case: when all stages have equal median HF (or all are null/zero),
 * every stage receives the middle difficulty level (3, "hard").
 */
export function assignDifficulty(
  medians: (number | null)[]
): { level: 1 | 2 | 3 | 4 | 5; label: string }[] {
  const validMedians = medians.filter((m): m is number => m !== null && m > 0);
  const maxMedian = validMedians.length > 0 ? Math.max(...validMedians) : 0;
  const minMedian = validMedians.length > 0 ? Math.min(...validMedians) : 0;
  const allEqual = maxMedian === 0 || maxMedian === minMedian;

  return medians.map((median) => {
    let level: 1 | 2 | 3 | 4 | 5;
    if (allEqual || median === null || median <= 0) {
      level = 3; // middle value when no differentiation is possible
    } else {
      const score = 1 - median / maxMedian;
      level = normalisedToLevel(score);
    }
    return { level, label: DIFFICULTY_LABELS[level] };
  });
}

/**
 * Given ALL scorecards for a match and the selected competitors, compute:
 *   - Group rankings (rank/% within selected competitors)
 *   - Division rankings (rank/% within each competitor's own division, full field)
 *   - Overall rankings (rank/% across the entire field regardless of division)
 *
 * Ranking uses hit factor (HF = points / time), not raw points.
 *
 * Rules:
 *   - DQ / zeroed → HF treated as 0, ranked last
 *   - DNF (stage not fired) → null rank/percent
 *   - Ties share the same rank; next rank skips
 */
export function computeGroupRankings(
  allScorecards: RawScorecard[],
  selectedCompetitors: CompetitorInfo[]
): StageComparison[] {
  const selectedIds = new Set(selectedCompetitors.map((c) => c.id));

  // Pre-compute per-competitor shooting order for selected competitors.
  // Strategy: sort each competitor's scorecards by scorecard_created (ISO string, lexicographic
  // sort works correctly). The position in that sorted list is their 1-based shooting order
  // for each stage. This reflects actual shooting order as recorded by the RO at the stage.
  const shootingOrderMap = new Map<number, Map<number, number>>(); // competitor_id → stage_id → order
  const byCompetitor = new Map<number, RawScorecard[]>();
  for (const sc of allScorecards) {
    if (!selectedIds.has(sc.competitor_id)) continue;
    const existing = byCompetitor.get(sc.competitor_id) ?? [];
    existing.push(sc);
    byCompetitor.set(sc.competitor_id, existing);
  }
  for (const [compId, cards] of byCompetitor) {
    const withTimestamp = cards.filter((sc) => sc.scorecard_created);
    if (withTimestamp.length === 0) continue;
    const sorted = [...withTimestamp].sort((a, b) =>
      a.scorecard_created!.localeCompare(b.scorecard_created!)
    );
    const orderMap = new Map<number, number>();
    sorted.forEach((sc, i) => orderMap.set(sc.stage_id, i + 1));
    shootingOrderMap.set(compId, orderMap);
  }

  // Group ALL scorecards by stage
  const byStage = new Map<number, RawScorecard[]>();
  for (const sc of allScorecards) {
    const existing = byStage.get(sc.stage_id) ?? [];
    existing.push(sc);
    byStage.set(sc.stage_id, existing);
  }

  // Sort stage IDs by stage number
  const stageIds = [...byStage.keys()].sort((a, b) => {
    return byStage.get(a)![0].stage_number - byStage.get(b)![0].stage_number;
  });

  const stageComparisons = stageIds.map((stageId) => {
    const allStage = byStage.get(stageId)!;
    const first = allStage[0];

    // Group rankings — selected competitors only
    const groupScorecards = allStage.filter((sc) =>
      selectedIds.has(sc.competitor_id)
    );
    const { rankMap: groupRankMap, leaderHF: groupLeaderHF } =
      rankByHF(groupScorecards);

    // Overall rankings — all competitors across all divisions
    const { rankMap: overallRankMap, leaderHF: overallLeaderHF } =
      rankByHF(allStage);
    // N for percentile: number of non-DNF competitors in the full field on this stage
    const overallN = overallRankMap.size;

    // Full-field median HF (excluding DNF/DQ/zeroed)
    const { median: fieldMedianHF, count: fieldCompetitorCount } =
      medianHF(allStage);

    // Division rankings — group by division string, rank within each
    const byDivision = new Map<string, RawScorecard[]>();
    for (const sc of allStage) {
      const key = sc.competitor_division ?? "__none__";
      const existing = byDivision.get(key) ?? [];
      existing.push(sc);
      byDivision.set(key, existing);
    }
    const divResults = new Map<
      string,
      { rankMap: Map<number, number>; leaderHF: number | null }
    >();
    for (const [div, divCards] of byDivision) {
      divResults.set(div, rankByHF(divCards));
    }

    // group_leader_points kept for the benchmark overlay hook (issue #1)
    const groupFired = groupScorecards.filter((sc) => !sc.dnf);
    const validPts = groupFired
      .map((sc) => (sc.dq || sc.zeroed ? 0 : (sc.points ?? 0)))
      .filter((p) => p > 0);
    const groupLeaderPoints = validPts.length > 0 ? Math.max(...validPts) : null;

    // Build competitor summaries for the selected competitors
    const competitorMap: Record<number, CompetitorSummary> = {};
    for (const comp of selectedCompetitors) {
      const sc = allStage.find((s) => s.competitor_id === comp.id);

      const shooting_order = shootingOrderMap.get(comp.id)?.get(stageId) ?? null;

      if (!sc || sc.dnf) {
        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: null,
          hit_factor: null,
          time: null,
          group_rank: null,
          group_percent: null,
          div_rank: null,
          div_percent: null,
          overall_rank: null,
          overall_percent: null,
          overall_percentile: null,
          dq: sc?.dq ?? false,
          zeroed: sc?.zeroed ?? false,
          dnf: true,
          incomplete: sc?.incomplete ?? false,
          a_hits: null,
          c_hits: null,
          d_hits: null,
          miss_count: null,
          no_shoots: null,
          procedurals: null,
          shooting_order,
          stageClassification: null,
        };
      } else {
        const hf = effectiveHF(sc);
        const pts = sc.dq || sc.zeroed ? 0 : (sc.points ?? null);
        const divKey = sc.competitor_division ?? "__none__";
        const divInfo = divResults.get(divKey);
        const overallRank = overallRankMap.get(comp.id) ?? null;
        const groupPercent = pct(hf, groupLeaderHF);

        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: pts,
          hit_factor: hf,
          time: sc.time,
          group_rank: groupRankMap.get(comp.id) ?? null,
          group_percent: groupPercent,
          div_rank: divInfo ? (divInfo.rankMap.get(comp.id) ?? null) : null,
          div_percent: divInfo ? pct(hf, divInfo.leaderHF) : null,
          overall_rank: overallRank,
          overall_percent: pct(hf, overallLeaderHF),
          overall_percentile: computePercentile(overallRank, overallN),
          dq: sc.dq,
          zeroed: sc.zeroed,
          dnf: false,
          incomplete: sc.incomplete,
          a_hits: sc.a_hits,
          c_hits: sc.c_hits,
          d_hits: sc.d_hits,
          miss_count: sc.miss_count,
          no_shoots: sc.no_shoots,
          procedurals: sc.procedurals,
          shooting_order,
          stageClassification: classifyStageRun(
            groupPercent,
            sc.a_hits,
            sc.c_hits,
            sc.d_hits,
            sc.miss_count,
            sc.no_shoots,
            sc.procedurals
          ),
        };
      }
    }

    const comparison: StageComparison = {
      stage_id: stageId,
      stage_name: first.stage_name,
      stage_num: first.stage_number,
      max_points: first.max_points,
      group_leader_hf: groupLeaderHF,
      group_leader_points: groupLeaderPoints,
      overall_leader_hf: overallLeaderHF,
      field_median_hf: fieldMedianHF,
      field_competitor_count: fieldCompetitorCount,
      // Difficulty is a placeholder here; overwritten in the second pass below
      // once all stage medians are known.
      stageDifficultyLevel: 3,
      stageDifficultyLabel: "hard",
      competitors: competitorMap,
    };

    return comparison;
  });

  // Second pass: assign relative difficulty levels now that all stage medians are known.
  const medians = stageComparisons.map((s) => s.field_median_hf);
  const difficulties = assignDifficulty(medians);

  return stageComparisons.map((s, i) => ({
    ...s,
    stageDifficultyLevel: difficulties[i].level,
    stageDifficultyLabel: difficulties[i].label,
  }));
}

/**
 * Compute per-competitor penalty statistics from already-ranked stage comparisons.
 *
 * Penalty metrics:
 *   - penaltiesPerStage        = total_penalties / stages_shot
 *   - penaltiesPer100Rounds    = total_penalties / total_rounds_fired × 100
 *
 * Penalty impact on match %:
 *   For each valid (non-DNF, non-DQ, non-zeroed) stage, compute the "clean" HF
 *   by adding back the penalty points (miss + no_shoot + procedural × 10 pts each),
 *   then compare average group % actual vs clean.
 *
 *   penaltyCostPercent = matchPctClean − matchPctActual
 */
export function computePenaltyStats(
  stages: StageComparison[],
  competitorId: number
): CompetitorPenaltyStats {
  let totalPenalties = 0;
  let totalRounds = 0;
  let stagesShot = 0;
  let actualPctSum = 0;
  let cleanPctSum = 0;
  let pctCount = 0;

  for (const stage of stages) {
    const sc = stage.competitors[competitorId];
    if (!sc || sc.dnf) continue;

    stagesShot++;
    const miss = sc.miss_count ?? 0;
    const ns = sc.no_shoots ?? 0;
    const proc = sc.procedurals ?? 0;
    totalPenalties += miss + ns + proc;

    // Total rounds on paper = hits + misses (procedurals are not per-round)
    totalRounds += (sc.a_hits ?? 0) + (sc.c_hits ?? 0) + (sc.d_hits ?? 0) + miss;

    // Penalty impact on match %: only meaningful for valid (non-DQ, non-zeroed) stages
    if (
      !sc.dq &&
      !sc.zeroed &&
      stage.group_leader_hf != null &&
      stage.group_leader_hf > 0 &&
      sc.time != null &&
      sc.time > 0
    ) {
      const actualHF = sc.hit_factor ?? 0;
      actualPctSum += (actualHF / stage.group_leader_hf) * 100;

      const cleanPoints = (sc.points ?? 0) + (miss + ns + proc) * 10;
      const cleanHF = cleanPoints / sc.time;
      cleanPctSum += (cleanHF / stage.group_leader_hf) * 100;

      pctCount++;
    }
  }

  const matchPctActual = pctCount > 0 ? actualPctSum / pctCount : 0;
  const matchPctClean = pctCount > 0 ? cleanPctSum / pctCount : 0;

  return {
    totalPenalties,
    penaltyCostPercent: matchPctClean - matchPctActual,
    matchPctActual,
    matchPctClean,
    penaltiesPerStage: stagesShot > 0 ? totalPenalties / stagesShot : 0,
    penaltiesPer100Rounds: totalRounds > 0 ? (totalPenalties / totalRounds) * 100 : 0,
  };
}

/**
 * Compute match-level points-per-shot for a single selected competitor using
 * already-ranked stage data.
 *
 *   points_per_shot = sum(points) / sum(rounds_fired)
 *
 * rounds_fired = A + C + D + miss (no-shoots are passive targets, excluded).
 * Returns null when the competitor fired zero rounds (guards against division by zero).
 */
export function computeCompetitorPPS(
  stages: StageComparison[],
  competitorId: number
): number | null {
  let totalPoints = 0;
  let totalRounds = 0;

  for (const stage of stages) {
    const sc = stage.competitors[competitorId];
    if (!sc || sc.dnf) continue;
    totalPoints += sc.points ?? 0;
    totalRounds +=
      (sc.a_hits ?? 0) + (sc.c_hits ?? 0) + (sc.d_hits ?? 0) + (sc.miss_count ?? 0);
  }

  if (totalRounds === 0) return null;
  return totalPoints / totalRounds;
}

/**
 * Compute the field-wide pts/shot distribution from ALL raw scorecards.
 *
 * For each competitor, aggregates points and rounds across all non-DNF stages.
 * Competitors with zero rounds fired are excluded (avoids division-by-zero outliers).
 *
 * Returns min, median, max, and the count of competitors included.
 * All values are null when no valid competitors exist.
 */
export function computeFieldPPSDistribution(
  allScorecards: RawScorecard[]
): Pick<EfficiencyStats, "fieldMin" | "fieldMedian" | "fieldMax" | "fieldCount"> {
  const byComp = new Map<number, { points: number; rounds: number }>();

  for (const sc of allScorecards) {
    if (sc.dnf) continue;
    const entry = byComp.get(sc.competitor_id) ?? { points: 0, rounds: 0 };
    entry.points += sc.points ?? 0;
    entry.rounds +=
      (sc.a_hits ?? 0) + (sc.c_hits ?? 0) + (sc.d_hits ?? 0) + (sc.miss_count ?? 0);
    byComp.set(sc.competitor_id, entry);
  }

  const ppsList: number[] = [];
  for (const { points, rounds } of byComp.values()) {
    if (rounds > 0) ppsList.push(points / rounds);
  }

  if (ppsList.length === 0) {
    return { fieldMin: null, fieldMedian: null, fieldMax: null, fieldCount: 0 };
  }

  const sorted = [...ppsList].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const fieldMedian =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  return {
    fieldMin: sorted[0],
    fieldMedian,
    fieldMax: sorted[sorted.length - 1],
    fieldCount: sorted.length,
  };
}

function ciLabel(cv: number): string {
  if (cv < 0.05) return "very consistent";
  if (cv < 0.10) return "consistent";
  if (cv < 0.15) return "moderate";
  if (cv < 0.20) return "variable";
  return "streaky";
}

/**
 * Compute per-competitor consistency index (coefficient of variation of group HF%).
 *
 *   CI = σ / μ   (population std dev divided by mean)
 *
 * Only non-DNF, non-DQ, non-zeroed stages with a valid group_percent contribute.
 * Returns null when fewer than 2 stages are available or when the mean is zero.
 */
export function computeConsistencyStats(
  stages: StageComparison[],
  competitorId: number
): ConsistencyStats {
  const values: number[] = [];

  for (const stage of stages) {
    const sc = stage.competitors[competitorId];
    if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;
    if (sc.group_percent != null) values.push(sc.group_percent);
  }

  const stagesFired = values.length;

  if (stagesFired < 2) {
    return { coefficientOfVariation: null, label: null, stagesFired };
  }

  const mean = values.reduce((a, b) => a + b, 0) / stagesFired;

  if (mean === 0) {
    return { coefficientOfVariation: null, label: null, stagesFired };
  }

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / stagesFired;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  return { coefficientOfVariation: cv, label: ciLabel(cv), stagesFired };
}
