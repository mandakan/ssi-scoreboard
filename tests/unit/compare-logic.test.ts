import { describe, it, expect } from "vitest";
import { computeGroupRankings, type RawScorecard } from "@/app/api/compare/logic";
import type { CompetitorInfo } from "@/lib/types";

const competitors: CompetitorInfo[] = [
  { id: 1, name: "Alice", competitor_number: "10", club: null, division: "hg1" },
  { id: 2, name: "Bob", competitor_number: "20", club: null, division: "hg3" },
  { id: 3, name: "Charlie", competitor_number: "30", club: null, division: "hg1" },
];

function makeCard(
  competitorId: number,
  stageId: number,
  overrides: Partial<RawScorecard> = {}
): RawScorecard {
  const comp = competitors.find((c) => c.id === competitorId);
  return {
    competitor_id: competitorId,
    competitor_division: comp?.division ?? null,
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

describe("computeGroupRankings — group rankings", () => {
  it("ranks competitors by hit_factor descending", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0, points: 100 }),
      makeCard(2, 1, { hit_factor: 4.0, points: 80 }),
      makeCard(3, 1, { hit_factor: 3.5, points: 70 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    const stage = result[0];
    expect(stage.competitors[1].group_rank).toBe(1);
    expect(stage.competitors[2].group_rank).toBe(2);
    expect(stage.competitors[3].group_rank).toBe(3);
  });

  it("HF leader ranks 1st even when they have fewer raw points", () => {
    // Comp 1: 100 pts in 25s → HF 4.00 (most points but loses)
    // Comp 2: 80 pts in 15s  → HF 5.33 (wins on HF)
    const scorecards = [
      makeCard(1, 1, { points: 100, time: 25, hit_factor: 4.0 }),
      makeCard(2, 1, { points: 80, time: 15, hit_factor: 5.333 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[2].group_rank).toBe(1);
    expect(result[0].competitors[1].group_rank).toBe(2);
  });

  it("computes group_percent as fraction of leader hit_factor", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 4.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].group_percent).toBe(100);
    expect(result[0].competitors[2].group_percent).toBeCloseTo(80, 5);
  });

  it("sets group_leader_hf to max valid hit_factor", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.5 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].group_leader_hf).toBe(5.0);
  });

  it("sets dnf=true and null rank/percent for stage-not-fired", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 4.0 }),
      makeCard(2, 1, { dnf: true, hit_factor: null }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    const stage = result[0];
    expect(stage.competitors[2].dnf).toBe(true);
    expect(stage.competitors[2].group_rank).toBeNull();
    expect(stage.competitors[2].group_percent).toBeNull();
  });

  it("treats DQ competitor as HF=0 for ranking", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 4.0 }),
      makeCard(2, 1, { dq: true, hit_factor: 6.0, points: 60 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].group_rank).toBe(1);
    expect(result[0].competitors[2].group_rank).toBe(2);
    expect(result[0].competitors[2].dq).toBe(true);
  });

  it("treats zeroed competitor as HF=0 and points=0", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 4.0 }),
      makeCard(2, 1, { zeroed: true, hit_factor: 3.0, points: 60 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[2].points).toBe(0);
    expect(result[0].competitors[2].hit_factor).toBe(0);
    expect(result[0].competitors[2].zeroed).toBe(true);
  });

  it("handles ties: same HF shares rank, next rank skips", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 4.0 }),
      makeCard(2, 1, { hit_factor: 4.0 }),
      makeCard(3, 1, { hit_factor: 3.0 }),
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

  it("produces null group_leader_hf when all competitors have dnf", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true }),
      makeCard(2, 1, { dnf: true }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].group_leader_hf).toBeNull();
    expect(result[0].competitors[1].group_rank).toBeNull();
    expect(result[0].competitors[2].group_rank).toBeNull();
  });
});

describe("computeGroupRankings — division rankings", () => {
  it("ranks each competitor within their own division", () => {
    // Alice (hg1) and Charlie (hg1) compete within hg1
    // Bob (hg3) is alone in hg3
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),  // Alice hg1
      makeCard(2, 1, { hit_factor: 6.0 }),  // Bob hg3
      makeCard(3, 1, { hit_factor: 4.0 }),  // Charlie hg1
    ];
    const result = computeGroupRankings(scorecards, competitors);
    const stage = result[0];
    // Bob has the highest HF overall but is alone in hg3 → div_rank 1
    expect(stage.competitors[2].div_rank).toBe(1);
    expect(stage.competitors[2].div_percent).toBeCloseTo(100, 5);
    // Alice is best in hg1 → div_rank 1
    expect(stage.competitors[1].div_rank).toBe(1);
    expect(stage.competitors[1].div_percent).toBeCloseTo(100, 5);
    // Charlie is 2nd in hg1 → div_rank 2, div_percent = 4.0/5.0*100
    expect(stage.competitors[3].div_rank).toBe(2);
    expect(stage.competitors[3].div_percent).toBeCloseTo(80, 5);
  });

  it("div_rank is null for dnf", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true }),
      makeCard(2, 1, { hit_factor: 5.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].div_rank).toBeNull();
  });
});

describe("computeGroupRankings — overall rankings", () => {
  it("ranks competitors across all divisions by HF", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),  // Alice hg1
      makeCard(2, 1, { hit_factor: 6.0 }),  // Bob hg3 — overall winner
      makeCard(3, 1, { hit_factor: 4.0 }),  // Charlie hg1
    ];
    const result = computeGroupRankings(scorecards, competitors);
    const stage = result[0];
    expect(stage.overall_leader_hf).toBe(6.0);
    expect(stage.competitors[2].overall_rank).toBe(1);
    expect(stage.competitors[1].overall_rank).toBe(2);
    expect(stage.competitors[3].overall_rank).toBe(3);
  });

  it("overall_percent uses the overall leader HF as reference", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 10.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].overall_percent).toBeCloseTo(50, 5);
    expect(result[0].competitors[2].overall_percent).toBeCloseTo(100, 5);
  });

  it("non-selected competitors contribute to overall ranking", () => {
    // A non-selected competitor (id=99) has the highest HF
    // Alice (selected) should rank 2nd overall
    const nonSelected: RawScorecard = {
      competitor_id: 99,
      competitor_division: "hg1",
      stage_id: 1,
      stage_number: 1,
      stage_name: "Stage 1",
      max_points: 100,
      points: 100,
      hit_factor: 8.0,
      time: 12.5,
      dq: false,
      zeroed: false,
      dnf: false,
    };
    const scorecards = [
      nonSelected,
      makeCard(1, 1, { hit_factor: 5.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    expect(result[0].overall_leader_hf).toBe(8.0);
    expect(result[0].competitors[1].overall_rank).toBe(2);
    expect(result[0].competitors[1].overall_percent).toBeCloseTo(62.5, 3);
  });
});
