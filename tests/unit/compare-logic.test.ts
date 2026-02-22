import { describe, it, expect } from "vitest";
import { computeGroupRankings, type RawScorecard } from "@/app/api/compare/logic";
import type { CompetitorInfo } from "@/lib/types";

const competitors: CompetitorInfo[] = [
  { id: 1, name: "Alice", competitor_number: "10", club: null, division: null },
  { id: 2, name: "Bob", competitor_number: "20", club: null, division: null },
  { id: 3, name: "Charlie", competitor_number: "30", club: null, division: null },
];

function makeCard(
  competitorId: number,
  stageId: number,
  overrides: Partial<RawScorecard> = {}
): RawScorecard {
  return {
    competitor_id: competitorId,
    stage_id: stageId,
    stage_number: stageId,
    stage_name: `Stage ${stageId}`,
    max_points: 100,
    points: 80,
    hit_factor: 4.0,
    time: 20,
    dq: false,
    zeroed: false,
    dnf: false,
    ...overrides,
  };
}

describe("computeGroupRankings", () => {
  it("ranks competitors by points descending", () => {
    const scorecards = [
      makeCard(1, 1, { points: 90 }),
      makeCard(2, 1, { points: 80 }),
      makeCard(3, 1, { points: 70 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    const stage = result[0];
    expect(stage.competitors[1].group_rank).toBe(1);
    expect(stage.competitors[2].group_rank).toBe(2);
    expect(stage.competitors[3].group_rank).toBe(3);
  });

  it("computes group_percent as fraction of leader points", () => {
    const scorecards = [
      makeCard(1, 1, { points: 100 }),
      makeCard(2, 1, { points: 80 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].group_percent).toBe(100);
    expect(result[0].competitors[2].group_percent).toBe(80);
  });

  it("sets group_leader_points to max valid points", () => {
    const scorecards = [
      makeCard(1, 1, { points: 90 }),
      makeCard(2, 1, { points: 70 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].group_leader_points).toBe(90);
  });

  it("sets dnf=true and null rank/percent for stage-not-fired", () => {
    const scorecards = [
      makeCard(1, 1, { points: 80 }),
      makeCard(2, 1, { dnf: true, points: null }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    const stage = result[0];
    expect(stage.competitors[2].dnf).toBe(true);
    expect(stage.competitors[2].group_rank).toBeNull();
    expect(stage.competitors[2].group_percent).toBeNull();
  });

  it("treats DQ competitor as 0 points for ranking", () => {
    const scorecards = [
      makeCard(1, 1, { points: 80 }),
      makeCard(2, 1, { dq: true, points: 60 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].group_rank).toBe(1);
    expect(result[0].competitors[2].group_rank).toBe(2);
    expect(result[0].competitors[2].dq).toBe(true);
  });

  it("treats zeroed competitor as 0 points", () => {
    const scorecards = [
      makeCard(1, 1, { points: 80 }),
      makeCard(2, 1, { zeroed: true, points: 60 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[2].points).toBe(0);
    expect(result[0].competitors[2].zeroed).toBe(true);
  });

  it("handles ties: same rank, next rank skips", () => {
    const scorecards = [
      makeCard(1, 1, { points: 80 }),
      makeCard(2, 1, { points: 80 }),
      makeCard(3, 1, { points: 70 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    const stage = result[0];
    expect(stage.competitors[1].group_rank).toBe(1);
    expect(stage.competitors[2].group_rank).toBe(1);
    expect(stage.competitors[3].group_rank).toBe(3); // skips rank 2
  });

  it("returns empty array for empty scorecards", () => {
    const result = computeGroupRankings([], competitors);
    expect(result).toEqual([]);
  });

  it("sorts stages by stage number", () => {
    const scorecards = [
      makeCard(1, 3, { stage_number: 3 }),
      makeCard(1, 1, { stage_number: 1 }),
      makeCard(1, 2, { stage_number: 2 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    expect(result.map((s) => s.stage_num)).toEqual([1, 2, 3]);
  });

  it("produces null rank for all competitors when all have no valid points", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true }),
      makeCard(2, 1, { dnf: true }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].group_leader_points).toBeNull();
    expect(result[0].competitors[1].group_rank).toBeNull();
    expect(result[0].competitors[2].group_rank).toBeNull();
  });
});
