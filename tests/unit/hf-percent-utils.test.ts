import { describe, it, expect } from "vitest";
import { computeHfPct } from "@/lib/hf-percent-utils";
import type { StageComparison, CompetitorSummary } from "@/lib/types";

function makeStage(
  competitorData: Record<number, Partial<CompetitorSummary>>
): StageComparison {
  const competitors: Record<number, CompetitorSummary> = {};
  for (const [rawId, overrides] of Object.entries(competitorData)) {
    const id = Number(rawId);
    competitors[id] = {
      competitor_id: id,
      hit_factor: 4.0,
      points: 80,
      time: 20,
      group_rank: 1,
      group_percent: 100,
      div_rank: 1,
      div_percent: 100,
      overall_rank: 1,
      overall_percent: 100,
      overall_percentile: 1.0,
      dq: false,
      zeroed: false,
      dnf: false,
      incomplete: false,
      a_hits: 8,
      c_hits: 0,
      d_hits: 0,
      miss_count: 0,
      no_shoots: 0,
      procedurals: 0,
      stageClassification: null,
      ...overrides,
    };
  }
  return {
    stage_id: 1,
    stage_name: "Stage 1",
    stage_num: 1,
    max_points: 100,
    group_leader_hf: 5.0,
    group_leader_points: 100,
    overall_leader_hf: 5.0,
    field_median_hf: 4.0,
    field_competitor_count: 2,
    stageDifficultyLevel: 3,
    stageDifficultyLabel: "hard",
    competitors,
  };
}

describe("computeHfPct — stage_winner mode", () => {
  it("returns overall_percent for a normal competitor", () => {
    const stage = makeStage({ 1: { hit_factor: 5.0, overall_percent: 100 } });
    expect(computeHfPct(stage, 1, "stage_winner")).toBe(100);
  });

  it("returns overall_percent when competitor is below the winner", () => {
    const stage = makeStage({ 1: { hit_factor: 4.0, overall_percent: 80 } });
    expect(computeHfPct(stage, 1, "stage_winner")).toBe(80);
  });

  it("returns null for a DNF competitor", () => {
    const stage = makeStage({ 1: { dnf: true, overall_percent: null } });
    expect(computeHfPct(stage, 1, "stage_winner")).toBeNull();
  });

  it("returns null when the competitor is not in the stage", () => {
    const stage = makeStage({ 2: { hit_factor: 4.0, overall_percent: 80 } });
    expect(computeHfPct(stage, 1, "stage_winner")).toBeNull();
  });

  it("returns null when overall_percent is null (no HF computed yet)", () => {
    const stage = makeStage({ 1: { hit_factor: null, overall_percent: null } });
    expect(computeHfPct(stage, 1, "stage_winner")).toBeNull();
  });
});

describe("computeHfPct — specific competitor reference mode", () => {
  it("returns 100 when competitor is the reference itself", () => {
    const stage = makeStage({ 1: { hit_factor: 5.0 } });
    expect(computeHfPct(stage, 1, 1)).toBe(100);
  });

  it("returns correct ratio when competitor is below the reference", () => {
    // 4.0 / 5.0 * 100 = 80
    const stage = makeStage({
      1: { hit_factor: 4.0 },
      2: { hit_factor: 5.0 },
    });
    expect(computeHfPct(stage, 1, 2)).toBeCloseTo(80, 5);
  });

  it("returns > 100 when competitor is above the reference", () => {
    // 6.0 / 5.0 * 100 = 120
    const stage = makeStage({
      1: { hit_factor: 6.0 },
      2: { hit_factor: 5.0 },
    });
    expect(computeHfPct(stage, 1, 2)).toBeCloseTo(120, 5);
  });

  it("returns null when the subject competitor is DNF", () => {
    const stage = makeStage({
      1: { dnf: true },
      2: { hit_factor: 5.0 },
    });
    expect(computeHfPct(stage, 1, 2)).toBeNull();
  });

  it("returns null when the reference competitor is DNF", () => {
    const stage = makeStage({
      1: { hit_factor: 4.0 },
      2: { dnf: true },
    });
    expect(computeHfPct(stage, 1, 2)).toBeNull();
  });

  it("returns null when the reference competitor has HF=0 (DQ/zeroed)", () => {
    const stage = makeStage({
      1: { hit_factor: 4.0 },
      2: { hit_factor: 0, zeroed: true },
    });
    expect(computeHfPct(stage, 1, 2)).toBeNull();
  });

  it("returns null when the subject competitor's HF is null", () => {
    const stage = makeStage({
      1: { hit_factor: null },
      2: { hit_factor: 5.0 },
    });
    expect(computeHfPct(stage, 1, 2)).toBeNull();
  });

  it("returns null when the reference competitor is not in the stage", () => {
    const stage = makeStage({ 1: { hit_factor: 4.0 } });
    // Competitor 99 does not exist in the stage
    expect(computeHfPct(stage, 1, 99)).toBeNull();
  });

  it("computes ratio correctly with non-round numbers", () => {
    // 3.5 / 5.6 * 100 ≈ 62.5
    const stage = makeStage({
      1: { hit_factor: 3.5 },
      2: { hit_factor: 5.6 },
    });
    expect(computeHfPct(stage, 1, 2)).toBeCloseTo((3.5 / 5.6) * 100, 5);
  });
});
