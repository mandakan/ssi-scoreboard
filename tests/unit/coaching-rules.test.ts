import { describe, it, expect } from "vitest";
import { computeFocusAreas } from "@/lib/coaching-rules";
import type {
  CompareResponse,
  CompetitorSummary,
  StageComparison,
  CompetitorPenaltyStats,
  StyleFingerprintStats,
  CourseLengthPerformance,
} from "@/lib/types";

// ── minimal fixture helpers ──────────────────────────────────────────────────

const BASE_COMPETITOR = {
  id: 1,
  shooterId: null,
  name: "Alice",
  competitor_number: "1",
  club: null,
  division: null,
  region: null,
  region_display: null,
  category: null,
  ics_alias: null,
  license: null,
};

function makeCompetitorSummary(overrides: Partial<CompetitorSummary> = {}): CompetitorSummary {
  return {
    competitor_id: 1,
    points: 80,
    hit_factor: 4.0,
    time: 20,
    group_rank: 1,
    group_percent: 90,
    div_rank: 1,
    div_percent: 90,
    overall_rank: 1,
    overall_percent: 90,
    overall_percentile: null,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 8,
    c_hits: 2,
    d_hits: 0,
    miss_count: 0,
    no_shoots: 0,
    procedurals: 0,
    shooting_order: null,
    stageClassification: null,
    hitLossPoints: null,
    penaltyLossPoints: 0,
    ...overrides,
  };
}

function makeStage(
  stageNum: number,
  competitorSummary: Partial<CompetitorSummary> = {},
  stageOverrides: Partial<StageComparison> = {},
): StageComparison {
  return {
    stage_id: stageNum,
    stage_name: `Stage ${stageNum}`,
    stage_num: stageNum,
    max_points: 100,
    group_leader_hf: 5.0,
    group_leader_points: 100,
    overall_leader_hf: 5.5,
    field_median_hf: 3.5,
    field_competitor_count: 20,
    field_median_accuracy: null,
    field_cv: null,
    stageDifficultyLevel: 3,
    stageDifficultyLabel: "Medium",
    stageSeparatorLevel: 2,
    competitors: { 1: makeCompetitorSummary(competitorSummary) },
    ...stageOverrides,
  };
}

function makePenaltyStats(overrides: Partial<CompetitorPenaltyStats> = {}): CompetitorPenaltyStats {
  return {
    totalPenalties: 0,
    penaltyCostPercent: 0,
    matchPctActual: 85,
    matchPctClean: 85,
    penaltiesPerStage: 0,
    penaltiesPer100Rounds: 0,
    ...overrides,
  };
}

function makeStyleFingerprint(overrides: Partial<StyleFingerprintStats> = {}): StyleFingerprintStats {
  return {
    alphaRatio: 0.8,
    pointsPerSecond: 5.0,
    penaltyRate: 0.02,
    totalA: 80,
    totalC: 10,
    totalD: 10,
    totalPoints: 800,
    totalTime: 160,
    totalPenalties: 2,
    totalRounds: 100,
    stagesFired: 8,
    accuracyPercentile: 60,
    speedPercentile: 60,
    archetype: "Grinder",
    composurePercentile: 70,
    consistencyPercentile: 65,
    ...overrides,
  };
}

function makeCourseLength(
  courseDisplay: string,
  avgGroupPercent: number,
  stageCount: number,
): CourseLengthPerformance {
  return { courseDisplay, stageCount, avgGroupPercent, avgDivPercent: null, avgOverallPercent: null };
}

function makeBaseCompare(stageOverrides: StageComparison[] = []): CompareResponse {
  const stages =
    stageOverrides.length > 0
      ? stageOverrides
      : Array.from({ length: 6 }, (_, i) => makeStage(i + 1));
  return {
    match_id: 1,
    mode: "coaching",
    stages,
    competitors: [BASE_COMPETITOR],
    penaltyStats: { 1: makePenaltyStats() },
    efficiencyStats: {},
    consistencyStats: { 1: { coefficientOfVariation: 0.05, label: "consistent", stagesFired: 6 } },
    lossBreakdownStats: { 1: { totalHitLoss: 5, totalPenaltyLoss: 0, totalLoss: 5, stagesFired: 6, hasHitZoneData: true } },
    whatIfStats: null,
    styleFingerprintStats: { 1: makeStyleFingerprint() },
    fieldFingerprintPoints: null,
    archetypePerformance: null,
    courseLengthPerformance: null,
    constraintPerformance: null,
    stageDegradationData: null,
    stageConditions: null,
    cacheInfo: { cachedAt: null },
  };
}

// ── safety rule ───────────────────────────────────────────────────────────────

describe("ruleSafety", () => {
  it("fires when a stage is DQ", () => {
    const compare = makeBaseCompare([
      makeStage(1, { dq: true }),
      makeStage(2),
      makeStage(3),
    ]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas[0].category).toBe("safety");
  });

  it("fires when a stage is DNF", () => {
    const compare = makeBaseCompare([makeStage(1, { dnf: true }), makeStage(2), makeStage(3)]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas[0].category).toBe("safety");
  });

  it("fires when a stage is zeroed", () => {
    const compare = makeBaseCompare([makeStage(1, { zeroed: true }), makeStage(2), makeStage(3)]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas[0].category).toBe("safety");
  });

  it("does not fire when all stages are clean", () => {
    const compare = makeBaseCompare();
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "safety")).toBeUndefined();
  });

  it("always sorts first even when other rules have higher recoverable %", () => {
    const compare = makeBaseCompare([makeStage(1, { dq: true }), makeStage(2), makeStage(3)]);
    compare.penaltyStats[1] = makePenaltyStats({ penaltyCostPercent: 25, totalPenalties: 10 });
    const areas = computeFocusAreas(compare, 1);
    expect(areas[0].category).toBe("safety");
  });
});

// ── mistake reduction rule ────────────────────────────────────────────────────

describe("ruleMistakeReduction", () => {
  it("fires when penalty cost >= 10%", () => {
    const compare = makeBaseCompare();
    compare.penaltyStats[1] = makePenaltyStats({
      penaltyCostPercent: 12.5,
      matchPctActual: 75,
      matchPctClean: 87.5,
      totalPenalties: 8,
    });
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "mistake-reduction")).toBeDefined();
  });

  it("does not fire when penalty cost < 10%", () => {
    const compare = makeBaseCompare();
    compare.penaltyStats[1] = makePenaltyStats({ penaltyCostPercent: 9.9 });
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "mistake-reduction")).toBeUndefined();
  });

  it("does not fire when penaltyStats missing", () => {
    const compare = makeBaseCompare();
    delete (compare.penaltyStats as Record<number, CompetitorPenaltyStats | undefined>)[1];
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "mistake-reduction")).toBeUndefined();
  });
});

// ── weak-hand rule ────────────────────────────────────────────────────────────

describe("ruleWeakHand", () => {
  function makeWeakHandStage(stageNum: number, groupPct: number): StageComparison {
    return makeStage(stageNum, { group_percent: groupPct }, { constraints: { weakHand: true, strongHand: false, movingTargets: false, unloadedStart: false } });
  }
  function makeNormalStage(stageNum: number, groupPct: number): StageComparison {
    return makeStage(stageNum, { group_percent: groupPct }, { constraints: { weakHand: false, strongHand: false, movingTargets: false, unloadedStart: false } });
  }

  it("fires when weak-hand avg is >=8% below normal and N>=3", () => {
    const compare = makeBaseCompare([
      makeWeakHandStage(1, 70),
      makeWeakHandStage(2, 68),
      makeWeakHandStage(3, 72),
      makeNormalStage(4, 85),
      makeNormalStage(5, 87),
      makeNormalStage(6, 83),
    ]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "weak-hand")).toBeDefined();
  });

  it("does not fire when weak-hand delta is < 8%", () => {
    const compare = makeBaseCompare([
      makeWeakHandStage(1, 80),
      makeWeakHandStage(2, 80),
      makeWeakHandStage(3, 80),
      makeNormalStage(4, 85),
      makeNormalStage(5, 85),
    ]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "weak-hand")).toBeUndefined();
  });

  it("does not fire when weak-hand N < 3", () => {
    const compare = makeBaseCompare([
      makeWeakHandStage(1, 60),
      makeWeakHandStage(2, 60),
      makeNormalStage(3, 85),
      makeNormalStage(4, 85),
    ]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "weak-hand")).toBeUndefined();
  });
});

// ── long stages rule ──────────────────────────────────────────────────────────

describe("ruleLongStages", () => {
  it("fires when Long avg is >=10% below Short and N>=2 each", () => {
    const compare = makeBaseCompare();
    compare.courseLengthPerformance = {
      1: [
        makeCourseLength("Short", 88, 3),
        makeCourseLength("Long", 72, 2),
      ],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "long-stages")).toBeDefined();
  });

  it("does not fire when delta < 10%", () => {
    const compare = makeBaseCompare();
    compare.courseLengthPerformance = {
      1: [
        makeCourseLength("Short", 85, 3),
        makeCourseLength("Long", 80, 3),
      ],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "long-stages")).toBeUndefined();
  });

  it("does not fire when Long N < 2", () => {
    const compare = makeBaseCompare();
    compare.courseLengthPerformance = {
      1: [
        makeCourseLength("Short", 90, 3),
        makeCourseLength("Long", 70, 1),
      ],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "long-stages")).toBeUndefined();
  });

  it("does not fire when Short N < 2", () => {
    const compare = makeBaseCompare();
    compare.courseLengthPerformance = {
      1: [
        makeCourseLength("Short", 90, 1),
        makeCourseLength("Long", 70, 3),
      ],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "long-stages")).toBeUndefined();
  });

  it("does not fire when courseLengthPerformance is null", () => {
    const compare = makeBaseCompare();
    compare.courseLengthPerformance = null;
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "long-stages")).toBeUndefined();
  });
});

// ── tempo rule ────────────────────────────────────────────────────────────────

describe("ruleTempo", () => {
  it("fires when speed < 30 and accuracy > 70", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 20, accuracyPercentile: 75, stagesFired: 6 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "tempo")).toBeDefined();
  });

  it("does not fire when speed >= 30", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 30, accuracyPercentile: 80 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "tempo")).toBeUndefined();
  });

  it("does not fire when accuracy <= 70", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 20, accuracyPercentile: 70 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "tempo")).toBeUndefined();
  });
});

// ── sight-discipline rule ─────────────────────────────────────────────────────

describe("ruleSightDiscipline", () => {
  it("fires when speed > 70 and accuracy < 30", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 80, accuracyPercentile: 20, stagesFired: 6 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "sight-discipline")).toBeDefined();
  });

  it("does not fire when speed <= 70", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 70, accuracyPercentile: 20 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "sight-discipline")).toBeUndefined();
  });

  it("does not fire when accuracy >= 30", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 80, accuracyPercentile: 30 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "sight-discipline")).toBeUndefined();
  });
});

// ── match-nerves rule ─────────────────────────────────────────────────────────

describe("ruleMatchNerves", () => {
  it("fires when career composure provided and drop >= 15", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ composurePercentile: 40 }),
    };
    const areas = computeFocusAreas(compare, 1, { careerComposurePercentile: 60 });
    expect(areas.find((a) => a.category === "match-nerves")).toBeDefined();
  });

  it("does not fire when drop < 15", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ composurePercentile: 55 }),
    };
    const areas = computeFocusAreas(compare, 1, { careerComposurePercentile: 60 });
    expect(areas.find((a) => a.category === "match-nerves")).toBeUndefined();
  });

  it("does not fire when careerComposurePercentile is null", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ composurePercentile: 30 }),
    };
    const areas = computeFocusAreas(compare, 1, { careerComposurePercentile: null });
    expect(areas.find((a) => a.category === "match-nerves")).toBeUndefined();
  });

  it("does not fire when careerComposurePercentile is omitted", () => {
    const compare = makeBaseCompare();
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ composurePercentile: 30 }),
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "match-nerves")).toBeUndefined();
  });
});

// ── stamina rule ──────────────────────────────────────────────────────────────

describe("ruleStamina", () => {
  function makeOrderedStages(orders: number[], pcts: number[]): StageComparison[] {
    return orders.map((order, i) =>
      makeStage(i + 1, { shooting_order: order, group_percent: pcts[i] }),
    );
  }

  it("fires when personal Spearman r < -0.3 with N>=4", () => {
    // Strongly negative: early stages high %, later stages low %
    const compare = makeBaseCompare(
      makeOrderedStages([1, 2, 3, 4, 5, 6], [95, 90, 80, 70, 60, 50]),
    );
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "stamina")).toBeDefined();
  });

  it("does not fire when r >= -0.3", () => {
    // Flat performance
    const compare = makeBaseCompare(
      makeOrderedStages([1, 2, 3, 4, 5, 6], [85, 86, 84, 85, 86, 84]),
    );
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "stamina")).toBeUndefined();
  });

  it("does not fire when N < 4", () => {
    // Only 3 stages with shooting_order
    const compare = makeBaseCompare([
      makeStage(1, { shooting_order: 1, group_percent: 90 }),
      makeStage(2, { shooting_order: 2, group_percent: 70 }),
      makeStage(3, { shooting_order: 3, group_percent: 50 }),
    ]);
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "stamina")).toBeUndefined();
  });

  it("excludes DQ/DNF/zeroed stages from correlation", () => {
    // Add DQ stages that would otherwise skew the correlation
    const stages = makeOrderedStages([1, 2, 3, 4, 5, 6], [85, 86, 84, 85, 86, 84]);
    // Inject DQ that looks like heavy degradation but should be excluded
    stages.push(makeStage(7, { shooting_order: 7, group_percent: 10, dq: true }));
    const compare = makeBaseCompare(stages);
    const areas = computeFocusAreas(compare, 1);
    expect(areas.find((a) => a.category === "stamina")).toBeUndefined();
  });
});

// ── output capping and ordering ───────────────────────────────────────────────

describe("output capping", () => {
  it("returns at most 3 focus areas", () => {
    // Trigger as many rules as possible simultaneously
    const compare = makeBaseCompare([
      makeStage(1, { dq: true, shooting_order: 1, group_percent: 90 }),
      makeStage(2, { shooting_order: 2, group_percent: 85 }),
      makeStage(3, { shooting_order: 3, group_percent: 75 }),
      makeStage(4, { shooting_order: 4, group_percent: 60 }),
      makeStage(5, { shooting_order: 5, group_percent: 50 }),
      makeStage(6, { shooting_order: 6, group_percent: 30 }),
    ]);
    compare.penaltyStats[1] = makePenaltyStats({ penaltyCostPercent: 15, totalPenalties: 10 });
    compare.styleFingerprintStats = {
      1: makeStyleFingerprint({ speedPercentile: 20, accuracyPercentile: 80 }),
    };
    compare.courseLengthPerformance = {
      1: [makeCourseLength("Short", 90, 3), makeCourseLength("Long", 70, 3)],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas.length).toBeLessThanOrEqual(3);
  });

  it("safety is first when multiple rules fire", () => {
    const compare = makeBaseCompare([makeStage(1, { zeroed: true }), makeStage(2), makeStage(3)]);
    compare.penaltyStats[1] = makePenaltyStats({ penaltyCostPercent: 20, totalPenalties: 8 });
    const areas = computeFocusAreas(compare, 1);
    expect(areas.length).toBeGreaterThan(0);
    expect(areas[0].category).toBe("safety");
  });

  it("returns empty array when no rules fire", () => {
    const compare = makeBaseCompare();
    // All defaults are below thresholds
    const areas = computeFocusAreas(compare, 1);
    expect(areas).toEqual([]);
  });

  it("remaining slots after safety are sorted by estimatedRecoverableMatchPct desc", () => {
    const compare = makeBaseCompare([makeStage(1, { dq: true }), makeStage(2), makeStage(3)]);
    compare.penaltyStats[1] = makePenaltyStats({ penaltyCostPercent: 15, totalPenalties: 6 });
    compare.courseLengthPerformance = {
      1: [makeCourseLength("Short", 90, 3), makeCourseLength("Long", 70, 3)],
    };
    const areas = computeFocusAreas(compare, 1);
    expect(areas[0].category).toBe("safety");
    // Subsequent items should have descending or equal estimatedRecoverableMatchPct
    for (let i = 1; i < areas.length - 1; i++) {
      const a = areas[i].estimatedRecoverableMatchPct ?? -Infinity;
      const b = areas[i + 1].estimatedRecoverableMatchPct ?? -Infinity;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });
});
