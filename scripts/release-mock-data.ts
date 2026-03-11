/**
 * Rich anonymized mock data for release screenshots.
 *
 * Designed to make every chart section render with realistic, visually
 * interesting data — more data-rich than the e2e test fixtures.
 *
 * Competitor names are generic but plausible Swedish names.
 * All match/club details are fictional.
 */

import type { MatchResponse, CompareResponse, ShooterDashboardResponse } from "../lib/types";

// ── Competitor IDs ────────────────────────────────────────────────────────────
const ID_A = 1001; // A. Lindström — strong all-rounder, slight precision edge
const ID_B = 1002; // B. Holm — speed demon, lower accuracy
const ID_C = 1003; // C. Berg — surgical precision, slower times

export const MOCK_MATCH: MatchResponse = {
  name: "Västra Regionmatch 2026",
  venue: "Skövde Skytteklubb",
  lat: 58.3897,
  lng: 13.8456,
  date: "2026-03-01T09:00:00+01:00",
  level: "l3",
  sub_rule: "nm",
  discipline: "IPSC Handgun",
  region: "SWE",
  stages_count: 6,
  competitors_count: 48,
  scoring_completed: 100,
  match_status: "cp",
  results_status: "all",
  ssi_url: "https://shootnscoreit.com/event/22/88888888/",
  cacheInfo: { cachedAt: "2026-03-02T12:00:00.000Z" },
  stages: [
    {
      id: 101,
      name: "Stage 1 – El Presidente",
      stage_number: 1,
      max_points: 120,
      min_rounds: 24,
      paper_targets: 12,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/101/",
      course_display: "Medium",
    },
    {
      id: 102,
      name: "Stage 2 – Speed Steel",
      stage_number: 2,
      max_points: 40,
      min_rounds: 5,
      paper_targets: 0,
      steel_targets: 5,
      ssi_url: "https://shootnscoreit.com/event/stage/24/102/",
      course_display: "Short",
    },
    {
      id: 103,
      name: "Stage 3 – Classique",
      stage_number: 3,
      max_points: 160,
      min_rounds: 32,
      paper_targets: 16,
      steel_targets: 2,
      ssi_url: "https://shootnscoreit.com/event/stage/24/103/",
      course_display: "Long",
    },
    {
      id: 104,
      name: "Stage 4 – Tight Boxes",
      stage_number: 4,
      max_points: 80,
      min_rounds: 16,
      paper_targets: 8,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/104/",
      course_display: "Medium",
    },
    {
      id: 105,
      name: "Stage 5 – Strong Hand Only",
      stage_number: 5,
      max_points: 60,
      min_rounds: 12,
      paper_targets: 6,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/105/",
      course_display: "Short",
    },
    {
      id: 106,
      name: "Stage 6 – Long Range",
      stage_number: 6,
      max_points: 200,
      min_rounds: 40,
      paper_targets: 20,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/106/",
      course_display: "Long",
    },
  ],
  competitors: [
    {
      id: ID_A,
      shooterId: 12345, // matches MOCK_SHOOTER_ID — enables identity/tracking buttons
      name: "A. Lindström",
      competitor_number: "12",
      club: "Göteborgs PK",
      division: "Production",
      region: null,
      region_display: null,
      category: null,
      ics_alias: null,
      license: null,
    },
    {
      id: ID_B,
      shooterId: 12346,
      name: "B. Holm",
      competitor_number: "27",
      club: "Malmö SKF",
      division: "Production",
      region: null,
      region_display: null,
      category: null,
      ics_alias: null,
      license: null,
    },
    {
      id: ID_C,
      shooterId: 12347,
      name: "C. Berg",
      competitor_number: "44",
      club: "Stockholms PK",
      division: "Production",
      region: null,
      region_display: null,
      category: null,
      ics_alias: null,
      license: null,
    },
  ],
  squads: [
    { id: 10, number: 1, name: "Squad 1", competitorIds: [ID_A, ID_B] },
    { id: 11, number: 2, name: "Squad 2", competitorIds: [ID_C] },
  ],
};

// ── Helper: build a CompetitorSummary ─────────────────────────────────────────

function cs(
  id: number,
  hf: number,
  pts: number,
  time: number,
  leaderHf: number,
  groupRank: number,
  divRank: number,
  overallRank: number,
  fieldSize: number,
  extras: {
    a?: number; c?: number; d?: number; miss?: number; ns?: number; proc?: number;
    dq?: boolean; zeroed?: boolean; dnf?: boolean;
    classification?: "solid" | "conservative" | "over-push" | "meltdown" | null;
    shootingOrder?: number;
  } = {},
) {
  const groupPct = leaderHf > 0 ? (hf / leaderHf) * 100 : null;
  const overallPct = groupPct; // simplified: leader is same for demo
  const overallPercentile =
    fieldSize > 1 ? 1 - (overallRank - 1) / (fieldSize - 1) : 1;

  const aHits = extras.a ?? null;
  const cHits = extras.c ?? null;
  const dHits = extras.d ?? null;
  const missCount = extras.miss ?? null;

  let hitLossPoints: number | null = null;
  if (aHits !== null && cHits !== null && dHits !== null && missCount !== null) {
    hitLossPoints = cHits * 1 + dHits * 3 + missCount * 5;
  }

  return {
    competitor_id: id,
    points: pts,
    hit_factor: hf,
    time,
    group_rank: groupRank,
    group_percent: groupPct,
    div_rank: divRank,
    div_percent: overallPct,
    overall_rank: overallRank,
    overall_percent: overallPct,
    overall_percentile: overallPercentile,
    dq: extras.dq ?? false,
    zeroed: extras.zeroed ?? false,
    dnf: extras.dnf ?? false,
    incomplete: false,
    a_hits: aHits,
    c_hits: cHits,
    d_hits: dHits,
    miss_count: missCount,
    no_shoots: extras.ns ?? null,
    procedurals: extras.proc ?? null,
    stageClassification: extras.classification ?? null,
    hitLossPoints,
    penaltyLossPoints: (extras.miss ?? 0) * 10 + (extras.ns ?? 0) * 10 + (extras.proc ?? 0) * 10,
    shooting_order: extras.shootingOrder ?? null,
    divisionKey: "Production",
  };
}

// ── Division HF distribution helper ──────────────────────────────────────────

function dist(min: number, q1: number, med: number, q3: number, count: number) {
  return { minPct: min, q1Pct: q1, medianPct: med, q3Pct: q3, count };
}

// ── Stage degradation data ────────────────────────────────────────────────────

// Stage 3 shows meaningful degradation (later shooters perform worse = negative r).
// Selected competitors (1001/1002/1003) are injected at early/mid/late positions so
// their colored dots appear on the chart against the gray field cloud.
const DEGRADATION_STAGE_3 = {
  stageId: 103,
  stageNum: 3,
  stageName: "Stage 3 – Classique",
  spearmanR: -0.38,
  spearmanSignificant: true,
  points: Array.from({ length: 48 }, (_, i) => {
    if (i === 4)  return { competitorId: 1001, shootingPosition: 5,  hfPercent: 89 }; // A. early, strong
    if (i === 22) return { competitorId: 1002, shootingPosition: 23, hfPercent: 71 }; // B. mid, on trend
    if (i === 39) return { competitorId: 1003, shootingPosition: 40, hfPercent: 51 }; // C. late, degraded
    return {
      competitorId: 2000 + i,
      shootingPosition: i + 1,
      hfPercent: Math.max(30, Math.min(100, 92 - i * 0.9 + (Math.sin(i * 1.3) * 12))),
    };
  }),
};

// Stage 1 shows no significant trend (r ≈ 0).
const DEGRADATION_STAGE_1 = {
  stageId: 101,
  stageNum: 1,
  stageName: "Stage 1 – El Presidente",
  spearmanR: 0.07,
  spearmanSignificant: false,
  points: Array.from({ length: 48 }, (_, i) => {
    if (i === 7)  return { competitorId: 1001, shootingPosition: 8,  hfPercent: 79 };
    if (i === 25) return { competitorId: 1002, shootingPosition: 26, hfPercent: 68 };
    if (i === 41) return { competitorId: 1003, shootingPosition: 42, hfPercent: 75 };
    return {
      competitorId: 2000 + i,
      shootingPosition: i + 1,
      hfPercent: Math.max(35, Math.min(100, 72 + Math.sin(i * 0.8) * 20 + Math.cos(i * 2.1) * 8)),
    };
  }),
};

export const MOCK_COMPARE: CompareResponse = {
  match_id: 88888888,
  mode: "coaching",
  cacheInfo: { cachedAt: "2026-03-02T12:00:00.000Z" },
  competitors: MOCK_MATCH.competitors,

  // ── Stages ─────────────────────────────────────────────────────────────────
  stages: [
    // Stage 1 – El Presidente (Mixed, medium, moderate separator)
    {
      stage_id: 101,
      stage_name: "Stage 1 – El Presidente",
      stage_num: 1,
      max_points: 120,
      course_display: "Medium",
      min_rounds: 24,
      paper_targets: 12,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/101/",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "mixed",
      group_leader_hf: 8.42,
      group_leader_points: 114,
      overall_leader_hf: 8.42,
      field_median_hf: 6.10,
      field_median_accuracy: 82.5,
      field_cv: 0.18,
      field_competitor_count: 48,
      stageDifficultyLevel: 3,
      stageDifficultyLabel: "Medium",
      stageSeparatorLevel: 2,
      divisionDistributions: {
        Production: dist(42, 68, 78, 91, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 8.21, 113, 13.77, 8.42, 1, 1, 1, 48,
          { a: 10, c: 2, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 2 }),
        [ID_B]: cs(ID_B, 8.42, 114, 13.54, 8.42, 1, 1, 1, 48,
          { a: 9, c: 2, d: 1, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 1 }),
        [ID_C]: cs(ID_C, 7.44, 110, 14.78, 8.42, 3, 3, 3, 48,
          { a: 8, c: 3, d: 1, miss: 0, ns: 0, proc: 0, classification: "conservative", shootingOrder: 3 }),
      },
    },

    // Stage 2 – Speed Steel (Speed, short, high separator)
    {
      stage_id: 102,
      stage_name: "Stage 2 – Speed Steel",
      stage_num: 2,
      max_points: 40,
      course_display: "Short",
      min_rounds: 5,
      paper_targets: 0,
      steel_targets: 5,
      ssi_url: "https://shootnscoreit.com/event/stage/24/102/",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "speed",
      group_leader_hf: 15.38,
      group_leader_points: 40,
      overall_leader_hf: 15.38,
      field_median_hf: 9.80,
      field_median_accuracy: 91.2,
      field_cv: 0.31,
      field_competitor_count: 48,
      stageDifficultyLevel: 1,
      stageDifficultyLabel: "Very high",
      stageSeparatorLevel: 3, // HIGH separator — this spreads the field
      divisionDistributions: {
        Production: dist(38, 55, 72, 88, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 13.89, 38, 2.74, 15.38, 2, 2, 2, 48,
          { classification: "solid", shootingOrder: 1 }),
        [ID_B]: cs(ID_B, 15.38, 40, 2.60, 15.38, 1, 1, 1, 48,
          { classification: "solid", shootingOrder: 3 }),
        [ID_C]: cs(ID_C, 10.00, 36, 3.60, 15.38, 3, 3, 3, 48,
          { classification: "conservative", shootingOrder: 2 }),
      },
    },

    // Stage 3 – Classique (Precision, long)
    {
      stage_id: 103,
      stage_name: "Stage 3 – Classique",
      stage_num: 3,
      max_points: 160,
      course_display: "Long",
      min_rounds: 32,
      paper_targets: 16,
      steel_targets: 2,
      ssi_url: "https://shootnscoreit.com/event/stage/24/103/",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "precision",
      group_leader_hf: 5.88,
      group_leader_points: 156,
      overall_leader_hf: 5.88,
      field_median_hf: 4.22,
      field_median_accuracy: 88.6,
      field_cv: 0.22,
      field_competitor_count: 48,
      stageDifficultyLevel: 4,
      stageDifficultyLabel: "Low",
      stageSeparatorLevel: 2,
      divisionDistributions: {
        Production: dist(48, 63, 75, 88, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 5.71, 154, 26.97, 5.88, 2, 2, 2, 48,
          { a: 14, c: 2, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 3 }),
        [ID_B]: cs(ID_B, 4.93, 146, 29.61, 5.88, 3, 3, 3, 48,
          { a: 11, c: 4, d: 1, miss: 0, ns: 0, proc: 0, classification: "conservative", shootingOrder: 2 }),
        [ID_C]: cs(ID_C, 5.88, 156, 26.53, 5.88, 1, 1, 1, 48,
          { a: 15, c: 1, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 1 }),
      },
    },

    // Stage 4 – Tight Boxes (Precision, medium)
    {
      stage_id: 104,
      stage_name: "Stage 4 – Tight Boxes",
      stage_num: 4,
      max_points: 80,
      course_display: "Medium",
      min_rounds: 16,
      paper_targets: 8,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/104/",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "precision",
      group_leader_hf: 6.15,
      group_leader_points: 78,
      overall_leader_hf: 6.15,
      field_median_hf: 4.85,
      field_median_accuracy: 86.1,
      field_cv: 0.15,
      field_competitor_count: 48,
      stageDifficultyLevel: 4,
      stageDifficultyLabel: "Low",
      stageSeparatorLevel: 1,
      divisionDistributions: {
        Production: dist(52, 70, 82, 92, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 5.80, 76, 13.10, 6.15, 2, 2, 2, 48,
          { a: 7, c: 1, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 2 }),
        [ID_B]: cs(ID_B, 5.54, 74, 13.36, 6.15, 3, 3, 3, 48,
          { a: 6, c: 2, d: 0, miss: 0, ns: 0, proc: 0, classification: "conservative", shootingOrder: 1 }),
        [ID_C]: cs(ID_C, 6.15, 78, 12.68, 6.15, 1, 1, 1, 48,
          { a: 8, c: 0, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 3 }),
      },
    },

    // Stage 5 – Strong Hand Only (Constrained, short)
    {
      stage_id: 105,
      stage_name: "Stage 5 – Strong Hand Only",
      stage_num: 5,
      max_points: 60,
      course_display: "Short",
      min_rounds: 12,
      paper_targets: 6,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/105/",
      constraints: { strongHand: true, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "mixed",
      group_leader_hf: 4.22,
      group_leader_points: 58,
      overall_leader_hf: 4.22,
      field_median_hf: 2.98,
      field_median_accuracy: 78.4,
      field_cv: 0.29,
      field_competitor_count: 48,
      stageDifficultyLevel: 5,
      stageDifficultyLabel: "Very low",
      stageSeparatorLevel: 2,
      divisionDistributions: {
        Production: dist(30, 52, 68, 85, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 3.98, 56, 14.07, 4.22, 2, 2, 2, 48,
          { a: 5, c: 1, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 3 }),
        [ID_B]: cs(ID_B, 4.22, 58, 13.74, 4.22, 1, 1, 1, 48,
          { a: 5, c: 1, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 2 }),
        [ID_C]: cs(ID_C, 3.34, 52, 15.57, 4.22, 3, 3, 3, 48,
          { a: 4, c: 1, d: 1, miss: 0, ns: 0, proc: 0, classification: "conservative", shootingOrder: 1 }),
      },
    },

    // Stage 6 – Long Range (Precision, very low HF)
    {
      stage_id: 106,
      stage_name: "Stage 6 – Long Range",
      stage_num: 6,
      max_points: 200,
      course_display: "Long",
      min_rounds: 40,
      paper_targets: 20,
      steel_targets: 0,
      ssi_url: "https://shootnscoreit.com/event/stage/24/106/",
      constraints: { strongHand: false, weakHand: false, movingTargets: false, unloadedStart: false },
      stageArchetype: "precision",
      group_leader_hf: 3.55,
      group_leader_points: 192,
      overall_leader_hf: 3.55,
      field_median_hf: 2.41,
      field_median_accuracy: 84.0,
      field_cv: 0.27,
      field_competitor_count: 48,
      stageDifficultyLevel: 5,
      stageDifficultyLabel: "Very low",
      stageSeparatorLevel: 2,
      divisionDistributions: {
        Production: dist(35, 55, 72, 88, 28),
      },
      competitors: {
        [ID_A]: cs(ID_A, 3.38, 188, 55.62, 3.55, 2, 2, 2, 48,
          { a: 17, c: 3, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 1 }),
        [ID_B]: cs(ID_B, 2.97, 182, 61.28, 3.55, 3, 3, 3, 48,
          { a: 14, c: 5, d: 1, miss: 0, ns: 0, proc: 0, classification: "conservative", shootingOrder: 3 }),
        [ID_C]: cs(ID_C, 3.55, 192, 54.08, 3.55, 1, 1, 1, 48,
          { a: 19, c: 1, d: 0, miss: 0, ns: 0, proc: 0, classification: "solid", shootingOrder: 2 }),
      },
    },
  ],

  // ── Penalty stats ───────────────────────────────────────────────────────────
  penaltyStats: {
    [ID_A]: {
      totalPenalties: 0,
      penaltyCostPercent: 0,
      matchPctActual: 91.8,
      matchPctClean: 91.8,
      penaltiesPerStage: 0,
      penaltiesPer100Rounds: 0,
    },
    [ID_B]: {
      totalPenalties: 0,
      penaltyCostPercent: 0,
      matchPctActual: 88.4,
      matchPctClean: 88.4,
      penaltiesPerStage: 0,
      penaltiesPer100Rounds: 0,
    },
    [ID_C]: {
      totalPenalties: 0,
      penaltyCostPercent: 0,
      matchPctActual: 90.6,
      matchPctClean: 90.6,
      penaltiesPerStage: 0,
      penaltiesPer100Rounds: 0,
    },
  },

  // ── Efficiency stats ────────────────────────────────────────────────────────
  efficiencyStats: {
    [ID_A]: { pointsPerShot: 4.82, fieldMin: 2.10, fieldMedian: 4.10, fieldMax: 5.50, fieldCount: 48 },
    [ID_B]: { pointsPerShot: 4.61, fieldMin: 2.10, fieldMedian: 4.10, fieldMax: 5.50, fieldCount: 48 },
    [ID_C]: { pointsPerShot: 5.24, fieldMin: 2.10, fieldMedian: 4.10, fieldMax: 5.50, fieldCount: 48 },
  },

  // ── Consistency stats ───────────────────────────────────────────────────────
  consistencyStats: {
    [ID_A]: { coefficientOfVariation: 0.082, label: "consistent", stagesFired: 6 },
    [ID_B]: { coefficientOfVariation: 0.124, label: "moderate", stagesFired: 6 },
    [ID_C]: { coefficientOfVariation: 0.066, label: "very consistent", stagesFired: 6 },
  },

  // ── Loss breakdown stats ────────────────────────────────────────────────────
  lossBreakdownStats: {
    [ID_A]: { totalHitLoss: 11, totalPenaltyLoss: 0, totalLoss: 11, stagesFired: 6, hasHitZoneData: true },
    [ID_B]: { totalHitLoss: 28, totalPenaltyLoss: 0, totalLoss: 28, stagesFired: 6, hasHitZoneData: true },
    [ID_C]: { totalHitLoss: 5,  totalPenaltyLoss: 0, totalLoss: 5,  stagesFired: 6, hasHitZoneData: true },
  },

  // ── What-if stats ───────────────────────────────────────────────────────────
  whatIfStats: {
    [ID_A]: {
      competitorId: ID_A,
      worstStageNum: 5,
      worstStageGroupPct: 94.3,
      actualMatchPct: 91.8,
      actualTotalPoints: 725,
      actualGroupRank: 2,
      actualDivRank: 4,
      actualOverallRank: 4,
      medianReplacement: { replacementPct: 94.0, matchPct: 92.5, totalPoints: 731, groupRank: 2, divRank: 3, overallRank: 3 },
      secondWorstReplacement: { replacementPct: 91.8, matchPct: 91.9, totalPoints: 726, groupRank: 2, divRank: 4, overallRank: 4 },
    },
    [ID_B]: {
      competitorId: ID_B,
      worstStageNum: 3,
      worstStageGroupPct: 83.8,
      actualMatchPct: 88.4,
      actualTotalPoints: 694,
      actualGroupRank: 3,
      actualDivRank: 8,
      actualOverallRank: 8,
      medianReplacement: { replacementPct: 90.0, matchPct: 89.0, totalPoints: 701, groupRank: 3, divRank: 7, overallRank: 7 },
      secondWorstReplacement: { replacementPct: 85.0, matchPct: 88.2, totalPoints: 692, groupRank: 3, divRank: 8, overallRank: 8 },
    },
    [ID_C]: {
      competitorId: ID_C,
      worstStageNum: 5,
      worstStageGroupPct: 79.1,
      actualMatchPct: 90.6,
      actualTotalPoints: 714,
      actualGroupRank: 2,
      actualDivRank: 5,
      actualOverallRank: 5,
      medianReplacement: { replacementPct: 92.0, matchPct: 91.2, totalPoints: 720, groupRank: 1, divRank: 3, overallRank: 3 },
      secondWorstReplacement: { replacementPct: 87.0, matchPct: 90.7, totalPoints: 715, groupRank: 2, divRank: 5, overallRank: 5 },
    },
  },

  // ── Style fingerprint stats ─────────────────────────────────────────────────
  styleFingerprintStats: {
    [ID_A]: {
      alphaRatio: 0.72,
      pointsPerSecond: 5.84,
      penaltyRate: 0,
      totalA: 61,
      totalC: 9,
      totalD: 1,
      totalPoints: 725,
      totalTime: 124.1,
      totalPenalties: 0,
      totalRounds: 138,
      stagesFired: 6,
      accuracyPercentile: 78,
      speedPercentile: 82,
      archetype: "Gunslinger",
      composurePercentile: 94,
      consistencyPercentile: 81,
    },
    [ID_B]: {
      alphaRatio: 0.55,
      pointsPerSecond: 6.28,
      penaltyRate: 0,
      totalA: 45,
      totalC: 14,
      totalD: 3,
      totalPoints: 694,
      totalTime: 110.5,
      totalPenalties: 0,
      totalRounds: 138,
      stagesFired: 6,
      accuracyPercentile: 51,
      speedPercentile: 94,
      archetype: "Speed Demon",
      composurePercentile: 88,
      consistencyPercentile: 62,
    },
    [ID_C]: {
      alphaRatio: 0.88,
      pointsPerSecond: 5.26,
      penaltyRate: 0,
      totalA: 73,
      totalC: 6,
      totalD: 1,
      totalPoints: 714,
      totalTime: 135.7,
      totalPenalties: 0,
      totalRounds: 138,
      stagesFired: 6,
      accuracyPercentile: 96,
      speedPercentile: 58,
      archetype: "Surgeon",
      composurePercentile: 97,
      consistencyPercentile: 91,
    },
  },

  // ── Field fingerprint points (background cohort cloud) ─────────────────────
  fieldFingerprintPoints: [
    ...Array.from({ length: 45 }, (_, i) => ({
      competitorId: 2000 + i,
      division: "Production" as const,
      alphaRatio: 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.55,
      pointsPerSecond: 2.5 + Math.abs(Math.cos(i * 2.1)) * 5.0,
      penaltyRate: Math.max(0, Math.sin(i * 0.9) * 0.05),
      accuracyPercentile: Math.round(10 + (i / 44) * 80 + Math.sin(i * 1.1) * 8),
      speedPercentile: Math.round(5 + Math.abs(Math.cos(i * 0.7)) * 90),
      cv: 0.05 + Math.abs(Math.sin(i * 2.3)) * 0.3,
      actualDivRank: i + 4,
      actualOverallRank: i + 4,
    })),
    // The 3 selected competitors also appear in the field
    { competitorId: ID_A, division: "Production", alphaRatio: 0.72, pointsPerSecond: 5.84, penaltyRate: 0, accuracyPercentile: 78, speedPercentile: 82, cv: 0.082, actualDivRank: 4, actualOverallRank: 4 },
    { competitorId: ID_B, division: "Production", alphaRatio: 0.55, pointsPerSecond: 6.28, penaltyRate: 0, accuracyPercentile: 51, speedPercentile: 94, cv: 0.124, actualDivRank: 8, actualOverallRank: 8 },
    { competitorId: ID_C, division: "Production", alphaRatio: 0.88, pointsPerSecond: 5.26, penaltyRate: 0, accuracyPercentile: 96, speedPercentile: 58, cv: 0.066, actualDivRank: 5, actualOverallRank: 5 },
  ],

  // ── Archetype performance ───────────────────────────────────────────────────
  archetypePerformance: {
    [ID_A]: [
      { archetype: "mixed",     stageCount: 2, avgGroupPercent: 96.0, avgDivPercent: 96.0, avgOverallPercent: 96.0 },
      { archetype: "speed",     stageCount: 1, avgGroupPercent: 90.3, avgDivPercent: 90.3, avgOverallPercent: 90.3 },
      { archetype: "precision", stageCount: 3, avgGroupPercent: 90.9, avgDivPercent: 90.9, avgOverallPercent: 90.9 },
    ],
    [ID_B]: [
      { archetype: "mixed",     stageCount: 2, avgGroupPercent: 95.1, avgDivPercent: 95.1, avgOverallPercent: 95.1 },
      { archetype: "speed",     stageCount: 1, avgGroupPercent: 100,  avgDivPercent: 100,  avgOverallPercent: 100  },
      { archetype: "precision", stageCount: 3, avgGroupPercent: 81.6, avgDivPercent: 81.6, avgOverallPercent: 81.6 },
    ],
    [ID_C]: [
      { archetype: "mixed",     stageCount: 2, avgGroupPercent: 84.8, avgDivPercent: 84.8, avgOverallPercent: 84.8 },
      { archetype: "speed",     stageCount: 1, avgGroupPercent: 65.0, avgDivPercent: 65.0, avgOverallPercent: 65.0 },
      { archetype: "precision", stageCount: 3, avgGroupPercent: 100,  avgDivPercent: 100,  avgOverallPercent: 100  },
    ],
  },

  // ── Course length performance ───────────────────────────────────────────────
  courseLengthPerformance: {
    [ID_A]: [
      { courseDisplay: "Short",  stageCount: 2, avgGroupPercent: 92.6, avgDivPercent: 92.6, avgOverallPercent: 92.6 },
      { courseDisplay: "Medium", stageCount: 2, avgGroupPercent: 95.8, avgDivPercent: 95.8, avgOverallPercent: 95.8 },
      { courseDisplay: "Long",   stageCount: 2, avgGroupPercent: 90.4, avgDivPercent: 90.4, avgOverallPercent: 90.4 },
    ],
    [ID_B]: [
      { courseDisplay: "Short",  stageCount: 2, avgGroupPercent: 97.8, avgDivPercent: 97.8, avgOverallPercent: 97.8 },
      { courseDisplay: "Medium", stageCount: 2, avgGroupPercent: 92.2, avgDivPercent: 92.2, avgOverallPercent: 92.2 },
      { courseDisplay: "Long",   stageCount: 2, avgGroupPercent: 79.6, avgDivPercent: 79.6, avgOverallPercent: 79.6 },
    ],
    [ID_C]: [
      { courseDisplay: "Short",  stageCount: 2, avgGroupPercent: 79.4, avgDivPercent: 79.4, avgOverallPercent: 79.4 },
      { courseDisplay: "Medium", stageCount: 2, avgGroupPercent: 94.3, avgDivPercent: 94.3, avgOverallPercent: 94.3 },
      { courseDisplay: "Long",   stageCount: 2, avgGroupPercent: 100,  avgDivPercent: 100,  avgOverallPercent: 100  },
    ],
  },

  // ── Constraint performance ──────────────────────────────────────────────────
  constraintPerformance: {
    [ID_A]: {
      normal:      { stageCount: 5, avgGroupPercent: 92.3 },
      constrained: { stageCount: 1, avgGroupPercent: 94.3 },
    },
    [ID_B]: {
      normal:      { stageCount: 5, avgGroupPercent: 88.8 },
      constrained: { stageCount: 1, avgGroupPercent: 100  },
    },
    [ID_C]: {
      normal:      { stageCount: 5, avgGroupPercent: 92.4 },
      constrained: { stageCount: 1, avgGroupPercent: 79.1 },
    },
  },

  // ── Stage degradation data ──────────────────────────────────────────────────
  stageDegradationData: [DEGRADATION_STAGE_3, DEGRADATION_STAGE_1], // S3 first = selected by default
  // Realistic Swedish March conditions: overcast morning warming to light drizzle midday.
  // Wind picking up from SW through the day; competitors shoot in different squad rotations.
  stageConditions: {
    101: {
      [ID_A]: { hourUtc: 8,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.1, windspeedMs: 2.4, windgustMs: 4.1, winddirectionDominant: "SW" },
      [ID_B]: { hourUtc: 11, weatherCode: 2,  weatherLabel: "partly cloudy", tempC: 6.3, windspeedMs: 6.8, windgustMs: 9.2, winddirectionDominant: "SW" },
      [ID_C]: { hourUtc: 13, weatherCode: 51, weatherLabel: "light drizzle", tempC: 7.0, windspeedMs: 8.5, windgustMs: 12.3, winddirectionDominant: "W" },
    },
    102: {
      [ID_A]: { hourUtc: 11, weatherCode: 2,  weatherLabel: "partly cloudy", tempC: 6.3, windspeedMs: 6.8, windgustMs: 9.2,  winddirectionDominant: "SW" },
      [ID_B]: { hourUtc: 8,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.1, windspeedMs: 2.4, windgustMs: 4.1,  winddirectionDominant: "SW" },
      [ID_C]: { hourUtc: 10, weatherCode: 3,  weatherLabel: "overcast",      tempC: 5.8, windspeedMs: 4.9, windgustMs: 7.3,  winddirectionDominant: "SW" },
    },
    103: {
      [ID_A]: { hourUtc: 13, weatherCode: 51, weatherLabel: "light drizzle", tempC: 7.0, windspeedMs: 8.5,  windgustMs: 12.3, winddirectionDominant: "W"  },
      [ID_B]: { hourUtc: 13, weatherCode: 51, weatherLabel: "light drizzle", tempC: 7.0, windspeedMs: 8.5,  windgustMs: 12.3, winddirectionDominant: "W"  },
      [ID_C]: { hourUtc: 8,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.1, windspeedMs: 2.4,  windgustMs: 4.1,  winddirectionDominant: "SW" },
    },
    104: {
      [ID_A]: { hourUtc: 9,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.7, windspeedMs: 3.2, windgustMs: 5.6,  winddirectionDominant: "SW" },
      [ID_B]: { hourUtc: 12, weatherCode: 51, weatherLabel: "light drizzle", tempC: 6.8, windspeedMs: 7.9, windgustMs: 11.4, winddirectionDominant: "W"  },
      [ID_C]: { hourUtc: 11, weatherCode: 2,  weatherLabel: "partly cloudy", tempC: 6.3, windspeedMs: 6.8, windgustMs: 9.2,  winddirectionDominant: "SW" },
    },
    105: {
      [ID_A]: { hourUtc: 12, weatherCode: 51, weatherLabel: "light drizzle", tempC: 6.8, windspeedMs: 7.9, windgustMs: 11.4, winddirectionDominant: "W"  },
      [ID_B]: { hourUtc: 9,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.7, windspeedMs: 3.2, windgustMs: 5.6,  winddirectionDominant: "SW" },
      [ID_C]: { hourUtc: 12, weatherCode: 51, weatherLabel: "light drizzle", tempC: 6.8, windspeedMs: 7.9, windgustMs: 11.4, winddirectionDominant: "W"  },
    },
    106: {
      [ID_A]: { hourUtc: 10, weatherCode: 3,  weatherLabel: "overcast",      tempC: 5.8, windspeedMs: 4.9, windgustMs: 7.3,  winddirectionDominant: "SW" },
      [ID_B]: { hourUtc: 10, weatherCode: 3,  weatherLabel: "overcast",      tempC: 5.8, windspeedMs: 4.9, windgustMs: 7.3,  winddirectionDominant: "SW" },
      [ID_C]: { hourUtc: 9,  weatherCode: 3,  weatherLabel: "overcast",      tempC: 4.7, windspeedMs: 3.2, windgustMs: 5.6,  winddirectionDominant: "SW" },
    },
  },
};

// ── Shooter dashboard mock ────────────────────────────────────────────────────
// Realistic Production shooter showing a clear upward trend over 5 matches.
export const MOCK_SHOOTER_ID = 12345;

export const MOCK_SHOOTER: ShooterDashboardResponse = {
  shooterId: MOCK_SHOOTER_ID,
  profile: {
    name: "A. Lindström",
    club: "Pistolskytte Stockholm",
    division: "Production",
    lastSeen: "2026-02-20T10:00:00Z",
    region: null,
    region_display: null,
    category: null,
    ics_alias: null,
    license: null,
  },
  matchCount: 5,
  matches: [
    {
      ct: "22",
      matchId: "27001",
      name: "Västra Open 2026",
      date: "2026-02-20T08:00:00Z",
      venue: "Skövde",
      level: "Level III",
      region: "Sweden",
      division: "Production",
      competitorId: 50001,
      competitorsInDivision: 24,
      stageCount: 18,
      avgHF: 4.93,
      matchPct: 79.1,
      totalA: 318,
      totalC: 82,
      totalD: 18,
      totalMiss: 0,
      totalNoShoots: 1,
    },
    {
      ct: "22",
      matchId: "26801",
      name: "Nordic Winter Cup 2025",
      date: "2025-12-06T08:00:00Z",
      venue: "Örebro",
      level: "Level II",
      region: "Sweden",
      division: "Production",
      competitorId: 48801,
      competitorsInDivision: 18,
      stageCount: 14,
      avgHF: 4.74,
      matchPct: 76.3,
      totalA: 241,
      totalC: 70,
      totalD: 16,
      totalMiss: 0,
      totalNoShoots: 0,
    },
    {
      ct: "22",
      matchId: "26501",
      name: "Höstmatch Göteborg 2025",
      date: "2025-10-11T08:00:00Z",
      venue: "Göteborg",
      level: "Level II",
      region: "Sweden",
      division: "Production",
      competitorId: 47201,
      competitorsInDivision: 15,
      stageCount: 12,
      avgHF: 4.62,
      matchPct: 74.8,
      totalA: 196,
      totalC: 58,
      totalD: 14,
      totalMiss: 0,
      totalNoShoots: 2,
    },
    {
      ct: "22",
      matchId: "26201",
      name: "Sommarmatch Malmö 2025",
      date: "2025-08-09T08:00:00Z",
      venue: "Malmö",
      level: "Level II",
      region: "Sweden",
      division: "Production",
      competitorId: 45901,
      competitorsInDivision: 12,
      stageCount: 10,
      avgHF: 4.48,
      matchPct: 73.5,
      totalA: 158,
      totalC: 47,
      totalD: 13,
      totalMiss: 0,
      totalNoShoots: 1,
    },
    {
      ct: "22",
      matchId: "25901",
      name: "Våropen Stockholm 2025",
      date: "2025-06-07T08:00:00Z",
      venue: "Stockholm",
      level: "Level II",
      region: "Sweden",
      division: "Production",
      competitorId: 44601,
      competitorsInDivision: 14,
      stageCount: 12,
      avgHF: 4.31,
      matchPct: 71.2,
      totalA: 192,
      totalC: 60,
      totalD: 18,
      totalMiss: 0,
      totalNoShoots: 2,
    },
  ],
  stats: {
    totalStages: 66,
    dateRange: {
      from: "2025-06-07T08:00:00Z",
      to: "2026-02-20T08:00:00Z",
    },
    overallAvgHF: 4.63,
    overallMatchPct: 74.98,
    aPercent: 71.4,
    cPercent: 20.8,
    dPercent: 5.3,
    missPercent: 2.5,
    consistencyCV: 0.054,
    hfTrendSlope: 0.155,
  },
};
