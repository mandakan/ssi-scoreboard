import { describe, it, expect } from "vitest";
import {
  isMajorPowerFactor,
  computePointDelta,
  simulateStageAdjustment,
  simulateMatchImpact,
} from "@/lib/what-if-calc";
import type {
  StageComparison,
  CompetitorSummary,
  StageSimulatorAdjustments,
} from "@/lib/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeCompetitor(overrides: Partial<CompetitorSummary> = {}): CompetitorSummary {
  return {
    competitor_id: 1,
    points: 72,
    hit_factor: 5.81,
    time: 12.4,
    group_rank: 2,
    group_percent: 87.2,
    div_rank: null,
    div_percent: null,
    overall_rank: null,
    overall_percent: null,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 12,
    c_hits: 4,
    d_hits: 0,
    miss_count: 2,
    no_shoots: 0,
    procedurals: 0,
    shooting_order: null,
    overall_percentile: null,
    stageClassification: null,
    hitLossPoints: null,
    penaltyLossPoints: 20,
    ...overrides,
  };
}

function makeStage(overrides: Partial<StageComparison> = {}): StageComparison {
  const competitor = makeCompetitor();
  return {
    stage_id: 3,
    stage_name: "The Maze",
    stage_num: 3,
    max_points: 96,
    group_leader_hf: 6.67,
    group_leader_points: null,
    overall_leader_hf: 7.0,
    field_median_hf: 4.5,
    field_competitor_count: 20,
    stageDifficultyLevel: 3,
    stageDifficultyLabel: "hard",
    competitors: { 1: competitor },
    ...overrides,
  };
}

const noAdj: StageSimulatorAdjustments = { timeDelta: 0, missToACount: 0, aToCCount: 0 };

// ─── isMajorPowerFactor ──────────────────────────────────────────────────────

describe("isMajorPowerFactor", () => {
  it("returns true for divisions ending in ' Major'", () => {
    expect(isMajorPowerFactor("Open Major")).toBe(true);
    expect(isMajorPowerFactor("Standard Major")).toBe(true);
  });

  it("returns false for divisions ending in ' Minor'", () => {
    expect(isMajorPowerFactor("Open Minor")).toBe(false);
    expect(isMajorPowerFactor("Standard Minor")).toBe(false);
  });

  it("returns false for single-power-factor divisions", () => {
    expect(isMajorPowerFactor("Production")).toBe(false);
    expect(isMajorPowerFactor("Production Optics")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isMajorPowerFactor(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMajorPowerFactor("")).toBe(false);
  });
});

// ─── computePointDelta ───────────────────────────────────────────────────────

describe("computePointDelta", () => {
  it("returns 0 with no adjustments", () => {
    expect(computePointDelta(noAdj, true)).toBe(0);
    expect(computePointDelta(noAdj, false)).toBe(0);
  });

  it("adds +15 pts per miss→A conversion (same for major and minor)", () => {
    const adj: StageSimulatorAdjustments = { ...noAdj, missToACount: 2 };
    expect(computePointDelta(adj, true)).toBe(30);
    expect(computePointDelta(adj, false)).toBe(30);
  });

  it("applies -1 pt per A→C swap for major", () => {
    const adj: StageSimulatorAdjustments = { ...noAdj, aToCCount: 3 };
    expect(computePointDelta(adj, true)).toBe(-3);
  });

  it("applies -2 pts per A→C swap for minor", () => {
    const adj: StageSimulatorAdjustments = { ...noAdj, aToCCount: 3 };
    expect(computePointDelta(adj, false)).toBe(-6);
  });

  it("combines miss→A and A→C correctly (major)", () => {
    // 1 miss→A: +15, 2 A→C: -2 → total +13
    const adj: StageSimulatorAdjustments = { ...noAdj, missToACount: 1, aToCCount: 2 };
    expect(computePointDelta(adj, true)).toBe(13);
  });

  it("combines miss→A and A→C correctly (minor)", () => {
    // 1 miss→A: +15, 2 A→C: -4 → total +11
    const adj: StageSimulatorAdjustments = { ...noAdj, missToACount: 1, aToCCount: 2 };
    expect(computePointDelta(adj, false)).toBe(11);
  });
});

// ─── simulateStageAdjustment ─────────────────────────────────────────────────

describe("simulateStageAdjustment", () => {
  it("returns current values with no adjustments", () => {
    const comp = makeCompetitor();
    const stage = makeStage();
    const result = simulateStageAdjustment(comp, stage, noAdj, false);
    expect(result.newPoints).toBeCloseTo(72, 5);
    expect(result.newTime).toBeCloseTo(12.4, 5);
    expect(result.newHF).toBeCloseTo(72 / 12.4, 5);
    expect(result.pointDelta).toBe(0);
  });

  it("increases HF when time decreases", () => {
    const comp = makeCompetitor();
    const stage = makeStage();
    const adj: StageSimulatorAdjustments = { timeDelta: -2, missToACount: 0, aToCCount: 0 };
    const result = simulateStageAdjustment(comp, stage, adj, false);
    expect(result.newTime).toBeCloseTo(10.4, 5);
    expect(result.newHF).toBeCloseTo(72 / 10.4, 5);
    expect(result.hfDelta).toBeGreaterThan(0);
  });

  it("time constrained to > 0", () => {
    const comp = makeCompetitor({ time: 5 });
    const stage = makeStage();
    const adj: StageSimulatorAdjustments = { timeDelta: -100, missToACount: 0, aToCCount: 0 };
    const result = simulateStageAdjustment(comp, stage, adj, false);
    expect(result.newTime).toBeGreaterThan(0);
  });

  it("converting 2 misses to A adds +30 pts (minor)", () => {
    const comp = makeCompetitor();
    const stage = makeStage();
    const adj: StageSimulatorAdjustments = { timeDelta: 0, missToACount: 2, aToCCount: 0 };
    const result = simulateStageAdjustment(comp, stage, adj, false);
    expect(result.newPoints).toBe(102);
    expect(result.pointDelta).toBe(30);
  });

  it("group percent capped at 100 when competitor becomes group leader", () => {
    // Comp currently at HF 5.81, leader is 6.67. Adjust time to beat the leader.
    const comp = makeCompetitor({ hit_factor: 5.81, time: 12.4, points: 72 });
    const stage = makeStage({ group_leader_hf: 6.67 });
    // new HF = 72 / 8.0 = 9.0 → beats leader
    const adj: StageSimulatorAdjustments = { timeDelta: -4.4, missToACount: 0, aToCCount: 0 };
    const result = simulateStageAdjustment(comp, stage, adj, false);
    expect(result.newHF).toBeGreaterThan(6.67);
    expect(result.newGroupLeaderHF).toBeCloseTo(result.newHF, 5);
    expect(result.newGroupPct).toBeCloseTo(100, 5);
  });

  it("group percent lower when group leader is higher than simulated HF", () => {
    const comp = makeCompetitor({ hit_factor: 5.81, time: 12.4, points: 72 });
    const stage = makeStage({ group_leader_hf: 6.67 });
    const result = simulateStageAdjustment(comp, stage, noAdj, false);
    expect(result.newGroupPct).not.toBeNull();
    expect(result.newGroupPct!).toBeLessThan(100);
  });

  it("groupPctDelta is null when group_percent is null", () => {
    const comp = makeCompetitor({ group_percent: null });
    const stage = makeStage({ group_leader_hf: null });
    const result = simulateStageAdjustment(comp, stage, noAdj, false);
    expect(result.groupPctDelta).toBeNull();
  });
});

// ─── simulateMatchImpact ─────────────────────────────────────────────────────

function makeMultiStage(): { stages: StageComparison[]; comp1: CompetitorSummary; comp2: CompetitorSummary } {
  // group_percent values are computed consistently: (hf / leaderHF) * 100
  // stage1: leader 6.67 → comp1 = 6.0/6.67*100 ≈ 89.955, comp2 = 100
  // stage2: leader 5.0  → comp1 = 4.25/5.0*100 = 85, comp2 = 4.0/5.0*100 = 80
  const comp1s1 = makeCompetitor({ competitor_id: 1, group_percent: (6.0 / 6.67) * 100, hit_factor: 6.0, time: 10, points: 60 });
  const comp2s1 = makeCompetitor({ competitor_id: 2, group_percent: 100, hit_factor: 6.67, time: 10, points: 66.7 });
  const comp1s2 = makeCompetitor({ competitor_id: 1, group_percent: 85, hit_factor: 4.25, time: 20, points: 85 });
  const comp2s2 = makeCompetitor({ competitor_id: 2, group_percent: 80, hit_factor: 4.0, time: 20, points: 80 });

  const stage1: StageComparison = {
    stage_id: 1, stage_name: "Stage 1", stage_num: 1, max_points: 80,
    group_leader_hf: 6.67, group_leader_points: null,
    overall_leader_hf: 6.67, field_median_hf: 5.0, field_competitor_count: 10,
    stageDifficultyLevel: 3, stageDifficultyLabel: "hard",
    competitors: { 1: comp1s1, 2: comp2s1 },
  };
  const stage2: StageComparison = {
    stage_id: 2, stage_name: "Stage 2", stage_num: 2, max_points: 100,
    group_leader_hf: 5.0, group_leader_points: null,
    overall_leader_hf: 5.0, field_median_hf: 3.5, field_competitor_count: 10,
    stageDifficultyLevel: 3, stageDifficultyLabel: "hard",
    competitors: { 1: comp1s2, 2: comp2s2 },
  };

  return { stages: [stage1, stage2], comp1: comp1s1, comp2: comp2s1 };
}

describe("simulateMatchImpact", () => {
  it("returns null deltas when no adjustment is made", () => {
    const { stages, comp1 } = makeMultiStage();
    const stage = stages[0];
    const simResult = simulateStageAdjustment(comp1, stage, noAdj, false);
    const impact = simulateMatchImpact(stages, 1, [1, 2], simResult);
    // With no change, matchPctDelta should be ~0
    expect(impact.matchPctDelta).toBeCloseTo(0, 4);
    expect(impact.groupRankDelta).toBe(0);
  });

  it("improving stage 1 increases match average", () => {
    const { stages, comp1 } = makeMultiStage();
    const stage = stages[0];
    // Convert 2 misses to A: +30 pts (minor)
    const adj: StageSimulatorAdjustments = { timeDelta: -2, missToACount: 2, aToCCount: 0 };
    const simResult = simulateStageAdjustment(comp1, stage, adj, false);
    const impact = simulateMatchImpact(stages, 1, [1, 2], simResult);
    expect(impact.matchPctDelta).not.toBeNull();
    expect(impact.matchPctDelta!).toBeGreaterThan(0);
  });

  it("competitor rank improves when simulation beats group leader match avg", () => {
    const { stages, comp1 } = makeMultiStage();
    // comp2 has higher avg currently (90+80)/2=85 for comp1, (100+80)/2=90 for comp2
    // Drastically improve comp1's stage 1 performance to beat comp2
    const stage = stages[0];
    const adj: StageSimulatorAdjustments = { timeDelta: -4, missToACount: 2, aToCCount: 0 };
    const simResult = simulateStageAdjustment(comp1, stage, adj, false);
    const impact = simulateMatchImpact(stages, 1, [1, 2], simResult);
    // If match avg improved enough, rank should improve
    if (impact.newMatchPct != null && impact.newMatchPct > 90) {
      expect(impact.newGroupRank).toBe(1);
    }
  });

  it("handles single competitor correctly", () => {
    const { stages, comp1 } = makeMultiStage();
    const stage = stages[0];
    const adj: StageSimulatorAdjustments = { timeDelta: -1, missToACount: 0, aToCCount: 0 };
    const simResult = simulateStageAdjustment(comp1, stage, adj, false);
    const impact = simulateMatchImpact(stages, 1, [1], simResult);
    expect(impact.newGroupRank).toBe(1);
    expect(impact.groupRankDelta).toBe(0);
  });

  it("DNF stages are excluded from average computation", () => {
    const { stages, comp1 } = makeMultiStage();
    // Mark stage 2 as DNF for comp1
    stages[1].competitors[1] = { ...stages[1].competitors[1], dnf: true, group_percent: null };
    const stage = stages[0];
    const simResult = simulateStageAdjustment(comp1, stage, noAdj, false);
    const impact = simulateMatchImpact(stages, 1, [1, 2], simResult);
    // Should still work (only stage 1 counts for comp1)
    expect(impact.newMatchPct).not.toBeNull();
  });
});
