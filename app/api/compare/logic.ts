// Pure function — no I/O, no side effects. Fully unit-tested.
// Extracted from compare/route.ts to keep it separately testable.

import type {
  StageComparison,
  CompetitorSummary,
  CompetitorInfo,
  CompetitorPenaltyStats,
  EfficiencyStats,
  ConsistencyStats,
  LossBreakdownStats,
  StyleFingerprintStats,
  FieldFingerprintPoint,
  ShooterArchetype,
  StageClassification,
  SimResult,
  WhatIfResult,
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
 * Compute the percentile rank of `value` within `allValues` on a 0–100 scale.
 * Uses the midpoint formula: (count below + 0.5 × count equal) / total × 100.
 * A single-element array returns 50 (the midpoint, not 0 or 100).
 * Returns null for empty arrays.
 */
export function computePercentileRank(value: number, allValues: number[]): number | null {
  if (allValues.length === 0) return null;
  const below = allValues.filter((v) => v < value).length;
  const equal = allValues.filter((v) => v === value).length;
  return ((below + 0.5 * equal) / allValues.length) * 100;
}

/**
 * Assign a shooter archetype based on field percentile ranks (0–100 each).
 *
 *   High accuracy (≥ 50) + High speed (≥ 50) → Gunslinger
 *   High accuracy (≥ 50) + Low  speed (< 50)  → Surgeon
 *   Low  accuracy (< 50) + High speed (≥ 50)  → Speed Demon
 *   Low  accuracy (< 50) + Low  speed (< 50)  → Grinder
 *
 * Returns null when either percentile is null.
 */
export function assignArchetype(
  accuracyPercentile: number | null,
  speedPercentile: number | null
): ShooterArchetype | null {
  if (accuracyPercentile === null || speedPercentile === null) return null;
  const highAccuracy = accuracyPercentile >= 50;
  const highSpeed = speedPercentile >= 50;
  if (highAccuracy && highSpeed) return "Gunslinger";
  if (highAccuracy) return "Surgeon";
  if (highSpeed) return "Speed Demon";
  return "Grinder";
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
          hitLossPoints: null,
          penaltyLossPoints: 0,
        };
      } else {
        const hf = effectiveHF(sc);
        const pts = sc.dq || sc.zeroed ? 0 : (sc.points ?? null);
        const divKey = sc.competitor_division ?? "__none__";
        const divInfo = divResults.get(divKey);
        const overallRank = overallRankMap.get(comp.id) ?? null;
        const groupPercent = pct(hf, groupLeaderHF);

        // Compute points-left-on-the-table split: hit quality vs. penalties.
        // penalty_loss = (miss + ns + proc) × 10 (each penalty costs 10 pts)
        // hit_loss     = (total_rounds × A_value) − sc.points − penalty_loss
        //              where A_value = 5 (constant regardless of major/minor).
        // hit_loss is null when zone data is unavailable (a/c/d/miss counts all null).
        const scMiss = sc.miss_count ?? 0;
        const scNs = sc.no_shoots ?? 0;
        const scProc = sc.procedurals ?? 0;
        const penaltyLossPoints = (scMiss + scNs + scProc) * 10;

        let hitLossPoints: number | null = null;
        if (
          !sc.dq && !sc.zeroed &&
          sc.points != null &&
          sc.a_hits != null && sc.c_hits != null && sc.d_hits != null && sc.miss_count != null
        ) {
          const totalRounds = sc.a_hits + sc.c_hits + sc.d_hits + sc.miss_count + scNs;
          const aMax = totalRounds * 5;
          hitLossPoints = Math.max(0, aMax - sc.points - penaltyLossPoints);
        }

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
          hitLossPoints,
          penaltyLossPoints,
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

/**
 * Aggregate per-stage hit-quality and penalty losses into match-level totals.
 *
 * Only non-DNF, non-DQ, non-zeroed stages are included (mirrors the coaching
 * intent: those stages had valid, countable results).
 *
 * hit_loss per stage  = (total_rounds × 5) − points − penalty_loss
 *   where total_rounds = a + c + d + miss + ns  (every round fired)
 * penalty_loss per stage = (miss + ns + proc) × 10
 *
 * hitLossPoints is null when zone data was unavailable on a stage.
 * Such stages still count toward stagesFired but not toward hasHitZoneData.
 */
export function computeLossBreakdown(
  stages: StageComparison[],
  competitorId: number
): LossBreakdownStats {
  let totalHitLoss = 0;
  let totalPenaltyLoss = 0;
  let stagesFired = 0;
  let hasHitZoneData = false;

  for (const stage of stages) {
    const sc = stage.competitors[competitorId];
    if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;
    stagesFired++;
    totalPenaltyLoss += sc.penaltyLossPoints;
    if (sc.hitLossPoints != null) {
      totalHitLoss += sc.hitLossPoints;
      hasHitZoneData = true;
    }
  }

  return {
    totalHitLoss,
    totalPenaltyLoss,
    totalLoss: totalHitLoss + totalPenaltyLoss,
    stagesFired,
    hasHitZoneData,
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

/**
 * Rank competitors by avg match % descending, handling ties (shared rank,
 * next rank skips). Returns a Map<competitor_id, rank>.
 */
function rankByMatchPct(pctMap: Map<number, number>): Map<number, number> {
  const sorted = [...pctMap.entries()].sort((a, b) => b[1] - a[1]);
  const rankMap = new Map<number, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1] < sorted[i - 1][1]) currentRank = i + 1;
    rankMap.set(sorted[i][0], currentRank);
  }
  return rankMap;
}

/**
 * Simulate replacing each competitor's worst stage with two alternative
 * performances and recompute match % and rank within the compared group.
 *
 * Scenarios:
 *   1. Median replacement  — replace worst stage with the competitor's own
 *      median group % across all other (non-worst) stages.
 *   2. Second-worst replacement — replace worst stage with the competitor's
 *      second-worst stage (conservative lower bound).
 *
 * Ranking is computed by substituting only the one competitor's simulated
 * match % while all other competitors keep their actual match %.
 *
 * Returns null for competitors with fewer than 2 valid stages (not enough
 * data to identify a "worst" vs a "rest").
 *
 * Valid stages: non-DNF, non-DQ, non-zeroed, with a non-null group_percent.
 */
export function simulateWithoutWorstStage(
  stages: StageComparison[],
  competitors: CompetitorInfo[]
): Record<number, WhatIfResult | null> {
  // Precompute each competitor's actual avg match % and total points.
  const actualPcts = new Map<number, number>();
  const actualTotalPoints = new Map<number, number>();

  for (const comp of competitors) {
    let pctSum = 0;
    let pctCount = 0;
    let totalPts = 0;
    for (const stage of stages) {
      const sc = stage.competitors[comp.id];
      if (!sc) continue;
      if (!sc.dnf) totalPts += sc.points ?? 0;
      if (!sc.dnf && !sc.dq && !sc.zeroed && sc.group_percent != null) {
        pctSum += sc.group_percent;
        pctCount++;
      }
    }
    actualPcts.set(comp.id, pctCount > 0 ? pctSum / pctCount : 0);
    actualTotalPoints.set(comp.id, totalPts);
  }

  const actualRankMap = rankByMatchPct(actualPcts);

  const result: Record<number, WhatIfResult | null> = {};

  for (const comp of competitors) {
    // Gather valid stages for this competitor.
    const validStages: Array<{
      stageNum: number;
      groupPct: number;
      actualPoints: number;
      groupLeaderPoints: number | null;
    }> = [];

    for (const stage of stages) {
      const sc = stage.competitors[comp.id];
      if (!sc || sc.dnf || sc.dq || sc.zeroed || sc.group_percent == null) continue;
      validStages.push({
        stageNum: stage.stage_num,
        groupPct: sc.group_percent,
        actualPoints: sc.points ?? 0,
        groupLeaderPoints: stage.group_leader_points,
      });
    }

    if (validStages.length < 2) {
      result[comp.id] = null;
      continue;
    }

    // Sort ascending by group_percent (worst first); use stage_num as tiebreaker.
    const sorted = [...validStages].sort(
      (a, b) => a.groupPct - b.groupPct || a.stageNum - b.stageNum
    );

    const worstStage = sorted[0];
    const remaining = sorted.slice(1); // all stages except the worst

    // Median of remaining stages (sorted ascending already).
    const remPcts = remaining.map((s) => s.groupPct); // already sorted ascending
    const mid = Math.floor(remPcts.length / 2);
    const medianPct =
      remPcts.length % 2 === 0
        ? (remPcts[mid - 1] + remPcts[mid]) / 2
        : remPcts[mid];

    // Second-worst = lowest of remaining (first in ascending sort).
    const secondWorstPct = remaining[0].groupPct;

    const actualMatchPct = actualPcts.get(comp.id) ?? 0;
    const totalPts = actualTotalPoints.get(comp.id) ?? 0;
    const pctSum = actualMatchPct * validStages.length;

    function simulate(replacementPct: number): SimResult {
      const simMatchPct =
        (pctSum - worstStage.groupPct + replacementPct) / validStages.length;

      // Estimate simulated points on the replaced stage via proportional scaling.
      let simWorstPoints: number;
      if (worstStage.groupLeaderPoints != null && worstStage.groupLeaderPoints > 0) {
        simWorstPoints = (replacementPct / 100) * worstStage.groupLeaderPoints;
      } else if (worstStage.groupPct > 0) {
        simWorstPoints =
          (replacementPct / worstStage.groupPct) * worstStage.actualPoints;
      } else {
        simWorstPoints = worstStage.actualPoints;
      }

      const simTotalPoints = Math.round(totalPts - worstStage.actualPoints + simWorstPoints);

      // Rank: this competitor uses simulated pct; all others keep actual pct.
      const simPcts = new Map<number, number>(actualPcts);
      simPcts.set(comp.id, simMatchPct);
      const simRankMap = rankByMatchPct(simPcts);

      return {
        replacementPct,
        matchPct: simMatchPct,
        totalPoints: simTotalPoints,
        groupRank: simRankMap.get(comp.id) ?? 1,
      };
    }

    result[comp.id] = {
      competitorId: comp.id,
      worstStageNum: worstStage.stageNum,
      worstStageGroupPct: worstStage.groupPct,
      actualMatchPct,
      actualTotalPoints: totalPts,
      actualGroupRank: actualRankMap.get(comp.id) ?? 1,
      medianReplacement: simulate(medianPct),
      secondWorstReplacement: simulate(secondWorstPct),
    };
  }

  return result;
}

/**
 * Compute the "shooter style fingerprint" — match-level aggregates that place
 * a competitor in a 2D accuracy × speed space.
 *
 * Metrics:
 *   alpha_ratio       = total_A / (total_A + total_C + total_D)
 *   points_per_second = total_points / total_time
 *   penalty_rate      = total_penalties / total_rounds_fired
 *
 * Only non-DNF, non-DQ, non-zeroed stages are included.
 * Returns null for ratio/rate fields when the denominators are zero.
 */
export function computeStyleFingerprint(
  stages: StageComparison[],
  competitorId: number
): StyleFingerprintStats {
  let totalA = 0;
  let totalC = 0;
  let totalD = 0;
  let totalPoints = 0;
  let totalTime = 0;
  let totalPenalties = 0;
  let totalRounds = 0;
  let stagesFired = 0;
  let hasZoneData = false;

  for (const stage of stages) {
    const sc = stage.competitors[competitorId];
    if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;
    stagesFired++;

    const a = sc.a_hits ?? 0;
    const c = sc.c_hits ?? 0;
    const d = sc.d_hits ?? 0;
    const miss = sc.miss_count ?? 0;
    const ns = sc.no_shoots ?? 0;
    const proc = sc.procedurals ?? 0;

    if (sc.a_hits != null || sc.c_hits != null || sc.d_hits != null) {
      hasZoneData = true;
    }

    totalA += a;
    totalC += c;
    totalD += d;
    totalPoints += sc.points ?? 0;
    totalTime += sc.time ?? 0;
    totalPenalties += miss + ns + proc;
    // rounds_fired: paper hits + misses (excludes no-shoots — passive targets)
    totalRounds += a + c + d + miss;
  }

  const zoneTotal = totalA + totalC + totalD;
  const alphaRatio = hasZoneData && zoneTotal > 0 ? totalA / zoneTotal : null;
  const pointsPerSecond = totalTime > 0 ? totalPoints / totalTime : null;
  const penaltyRate = totalRounds > 0 ? totalPenalties / totalRounds : null;

  return {
    alphaRatio,
    pointsPerSecond,
    penaltyRate,
    totalA,
    totalC,
    totalD,
    totalPoints,
    totalTime,
    totalPenalties,
    totalRounds,
    stagesFired,
    // Percentile fields are populated in route.ts after fieldFingerprintPoints is available.
    accuracyPercentile: null,
    speedPercentile: null,
    archetype: null,
  };
}

/**
 * Compute the style-fingerprint position for EVERY competitor in the match,
 * working directly from raw scorecards (not the selected-competitor stage map).
 *
 * Used to populate the background cohort cloud on the scatter chart so that
 * selected competitors can be seen in context of the full field or their division.
 *
 * A competitor is included only when they have:
 *   - at least one non-DNF, non-DQ, non-zeroed stage with time > 0
 *   - zone data (a/c/d hits) available for the alpha-ratio calculation
 *
 * @param allScorecards All raw scorecards for the match (full field, all stages).
 * @param divisionMap   competitor_id → division string (from match competitor list).
 */
export function computeAllFingerprintPoints(
  allScorecards: RawScorecard[],
  divisionMap: Map<number, string | null>
): FieldFingerprintPoint[] {
  // Aggregate per competitor across all stages
  const byComp = new Map<
    number,
    {
      totalA: number;
      totalC: number;
      totalD: number;
      totalPoints: number;
      totalTime: number;
      totalPenalties: number;
      totalRounds: number;
      hasZoneData: boolean;
    }
  >();

  for (const sc of allScorecards) {
    if (sc.dnf || sc.dq || sc.zeroed) continue;
    if (!sc.time || sc.time <= 0) continue;

    const entry = byComp.get(sc.competitor_id) ?? {
      totalA: 0, totalC: 0, totalD: 0,
      totalPoints: 0, totalTime: 0,
      totalPenalties: 0, totalRounds: 0,
      hasZoneData: false,
    };

    const a = sc.a_hits ?? 0;
    const c = sc.c_hits ?? 0;
    const d = sc.d_hits ?? 0;
    const miss = sc.miss_count ?? 0;
    const ns = sc.no_shoots ?? 0;
    const proc = sc.procedurals ?? 0;

    if (sc.a_hits != null || sc.c_hits != null || sc.d_hits != null) {
      entry.hasZoneData = true;
    }

    entry.totalA += a;
    entry.totalC += c;
    entry.totalD += d;
    entry.totalPoints += sc.points ?? 0;
    entry.totalTime += sc.time;
    entry.totalPenalties += miss + ns + proc;
    entry.totalRounds += a + c + d + miss;

    byComp.set(sc.competitor_id, entry);
  }

  // First pass: compute raw metrics for each valid competitor.
  const rawPoints: Omit<FieldFingerprintPoint, "accuracyPercentile" | "speedPercentile">[] = [];

  for (const [competitorId, agg] of byComp) {
    if (!agg.hasZoneData) continue;
    if (agg.totalTime <= 0) continue;

    const zoneTotal = agg.totalA + agg.totalC + agg.totalD;
    if (zoneTotal <= 0) continue;

    rawPoints.push({
      competitorId,
      division: divisionMap.get(competitorId) ?? null,
      alphaRatio: agg.totalA / zoneTotal,
      pointsPerSecond: agg.totalPoints / agg.totalTime,
      penaltyRate: agg.totalRounds > 0 ? agg.totalPenalties / agg.totalRounds : 0,
    });
  }

  // Second pass: compute field-wide percentile ranks and attach them.
  const allAlphaRatios = rawPoints.map((p) => p.alphaRatio);
  const allSpeeds = rawPoints.map((p) => p.pointsPerSecond);

  return rawPoints.map((p) => ({
    ...p,
    accuracyPercentile: computePercentileRank(p.alphaRatio, allAlphaRatios) ?? 50,
    speedPercentile: computePercentileRank(p.pointsPerSecond, allSpeeds) ?? 50,
  }));
}
