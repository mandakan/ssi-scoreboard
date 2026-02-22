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
    incomplete: false,
    a_hits: 10,
    c_hits: 2,
    d_hits: 0,
    miss_count: 0,
    no_shoots: 0,
    procedurals: 0,
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

describe("computeGroupRankings — penalty fields", () => {
  it("passes miss_count, no_shoots, and procedurals through to CompetitorSummary", () => {
    const scorecards = [
      makeCard(1, 1, { miss_count: 2, no_shoots: 1, procedurals: 1 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    const sc = result[0].competitors[1];
    expect(sc.miss_count).toBe(2);
    expect(sc.no_shoots).toBe(1);
    expect(sc.procedurals).toBe(1);
  });

  it("preserves zero penalty fields for a clean stage", () => {
    const scorecards = [
      makeCard(1, 1, { miss_count: 0, no_shoots: 0, procedurals: 0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    const sc = result[0].competitors[1];
    expect(sc.miss_count).toBe(0);
    expect(sc.no_shoots).toBe(0);
    expect(sc.procedurals).toBe(0);
  });

  it("sets all penalty fields to null for a DNF stage", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true, miss_count: 2, no_shoots: 0, procedurals: 1 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    const sc = result[0].competitors[1];
    expect(sc.miss_count).toBeNull();
    expect(sc.no_shoots).toBeNull();
    expect(sc.procedurals).toBeNull();
  });
});

describe("computeGroupRankings — shooting order", () => {
  it("derives shooting order from scorecard_created timestamps", () => {
    // Alice shot stage 2 first, then stage 1
    const scorecards = [
      makeCard(1, 1, { scorecard_created: "2026-02-22T12:00:00Z" }),
      makeCard(1, 2, { scorecard_created: "2026-02-22T10:00:00Z" }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    // stage 2 was first (earlier timestamp) → shooting_order 1
    const stage2 = result.find((s) => s.stage_num === 2)!;
    expect(stage2.competitors[1].shooting_order).toBe(1);
    // stage 1 was second → shooting_order 2
    const stage1 = result.find((s) => s.stage_num === 1)!;
    expect(stage1.competitors[1].shooting_order).toBe(2);
  });

  it("two competitors can have different shooting orders for the same stage", () => {
    // Alice: stage 1 first, stage 2 second
    // Bob:   stage 2 first, stage 1 second
    const scorecards = [
      makeCard(1, 1, { scorecard_created: "2026-02-22T10:00:00Z" }),
      makeCard(1, 2, { scorecard_created: "2026-02-22T12:00:00Z" }),
      makeCard(2, 1, { scorecard_created: "2026-02-22T12:30:00Z" }),
      makeCard(2, 2, { scorecard_created: "2026-02-22T10:30:00Z" }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    const stage1 = result.find((s) => s.stage_num === 1)!;
    expect(stage1.competitors[1].shooting_order).toBe(1); // Alice shot stage 1 first
    expect(stage1.competitors[2].shooting_order).toBe(2); // Bob shot stage 1 second
    const stage2 = result.find((s) => s.stage_num === 2)!;
    expect(stage2.competitors[1].shooting_order).toBe(2); // Alice shot stage 2 second
    expect(stage2.competitors[2].shooting_order).toBe(1); // Bob shot stage 2 first
  });

  it("shooting_order is null when no scorecard_created timestamps are present", () => {
    const scorecards = [
      makeCard(1, 1),
      makeCard(1, 2),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    for (const stage of result) {
      expect(stage.competitors[1].shooting_order).toBeNull();
    }
  });

  it("shooting_order is null for stages with no timestamp even when other stages have one", () => {
    // stage 1 has a timestamp, stage 2 does not
    const scorecards = [
      makeCard(1, 1, { scorecard_created: "2026-02-22T10:00:00Z" }),
      makeCard(1, 2, { scorecard_created: null }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    const stage2 = result.find((s) => s.stage_num === 2)!;
    expect(stage2.competitors[1].shooting_order).toBeNull();
  });

  it("non-selected competitors do not affect shooting order computation", () => {
    // comp id 99 is not selected — should be ignored
    const nonSelected: RawScorecard = {
      competitor_id: 99,
      competitor_division: "hg1",
      stage_id: 1,
      stage_number: 1,
      stage_name: "Stage 1",
      max_points: 100,
      points: 80,
      hit_factor: 4.0,
      time: 20,
      dq: false,
      zeroed: false,
      dnf: false,
      incomplete: false,
      a_hits: null,
      c_hits: null,
      d_hits: null,
      miss_count: null,
      no_shoots: null,
      procedurals: null,
      scorecard_created: "2026-02-22T08:00:00Z",
    };
    const scorecards = [
      nonSelected,
      makeCard(1, 1, { scorecard_created: "2026-02-22T10:00:00Z" }),
      makeCard(1, 2, { scorecard_created: "2026-02-22T12:00:00Z" }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    const stage1 = result.find((s) => s.stage_num === 1)!;
    expect(stage1.competitors[1].shooting_order).toBe(1);
  });
});

describe("computeGroupRankings — field median HF", () => {
  it("computes median for an odd number of competitors", () => {
    // sorted: [3.0, 4.0, 5.0] → median = 4.0
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
      makeCard(3, 1, { hit_factor: 4.0 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(3);
  });

  it("computes median for an even number of competitors", () => {
    // sorted: [3.0, 5.0] → median = (3.0 + 5.0) / 2 = 4.0
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(2);
  });

  it("excludes DNF competitors from the median", () => {
    // sorted valid: [3.0, 5.0] → median = 4.0; DNF is excluded
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
      makeCard(3, 1, { dnf: true, hit_factor: null }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(2);
  });

  it("excludes DQ competitors from the median", () => {
    // DQ competitor has reported HF=6.0 but is excluded from median
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
      makeCard(3, 1, { dq: true, hit_factor: 6.0 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(2);
  });

  it("excludes zeroed competitors from the median", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
      makeCard(3, 1, { zeroed: true, hit_factor: 4.5 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(2);
  });

  it("returns null median and count 0 when all competitors have DNF", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true }),
      makeCard(2, 1, { dnf: true }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].field_median_hf).toBeNull();
    expect(result[0].field_competitor_count).toBe(0);
  });

  it("returns correct median and count for a single competitor", () => {
    const scorecards = [makeCard(1, 1, { hit_factor: 4.5 })];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    expect(result[0].field_median_hf).toBe(4.5);
    expect(result[0].field_competitor_count).toBe(1);
  });

  it("includes non-selected competitors in the full-field median", () => {
    // Non-selected competitor (id=99) contributes to median
    // sorted valid: [3.0, 5.0, 8.0] → median = 5.0
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
      incomplete: false,
      a_hits: 12,
      c_hits: 0,
      d_hits: 0,
      miss_count: 0,
      no_shoots: 0,
      procedurals: 0,
    };
    const scorecards = [
      nonSelected,
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: 3.0 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].field_median_hf).toBe(5.0);
    expect(result[0].field_competitor_count).toBe(3);
  });

  it("excludes null hit_factor entries from the median", () => {
    // hit_factor=null means API hasn't computed it yet
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0 }),
      makeCard(2, 1, { hit_factor: null }),
      makeCard(3, 1, { hit_factor: 3.0 }),
    ];
    const result = computeGroupRankings(scorecards, competitors);
    expect(result[0].field_median_hf).toBe(4.0);
    expect(result[0].field_competitor_count).toBe(2);
  });

  it("computes median per stage independently", () => {
    const scorecards = [
      makeCard(1, 1, { hit_factor: 2.0 }),
      makeCard(2, 1, { hit_factor: 4.0 }),
      makeCard(1, 2, { hit_factor: 6.0, stage_number: 2 }),
      makeCard(2, 2, { hit_factor: 8.0, stage_number: 2 }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    const stage1 = result.find((s) => s.stage_num === 1)!;
    const stage2 = result.find((s) => s.stage_num === 2)!;
    expect(stage1.field_median_hf).toBe(3.0);
    expect(stage2.field_median_hf).toBe(7.0);
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
      incomplete: false,
      a_hits: 12,
      c_hits: 0,
      d_hits: 0,
      miss_count: 0,
      no_shoots: 0,
      procedurals: 0,
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

describe("computeGroupRankings — incomplete scorecard flag", () => {
  it("passes incomplete=true through to CompetitorSummary", () => {
    const scorecards = [
      makeCard(1, 1, { incomplete: true }),
      makeCard(2, 1, { incomplete: false }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].incomplete).toBe(true);
    expect(result[0].competitors[2].incomplete).toBe(false);
  });

  it("incomplete scorecard is still ranked by hit_factor", () => {
    // Incomplete stages are flagged but still participate in ranking
    const scorecards = [
      makeCard(1, 1, { hit_factor: 5.0, incomplete: true }),
      makeCard(2, 1, { hit_factor: 3.0, incomplete: false }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0], competitors[1]]);
    expect(result[0].competitors[1].group_rank).toBe(1);
    expect(result[0].competitors[2].group_rank).toBe(2);
  });

  it("sets incomplete=false for a DNF stage (no scorecard)", () => {
    const scorecards = [
      makeCard(1, 1, { dnf: true, incomplete: false }),
    ];
    const result = computeGroupRankings(scorecards, [competitors[0]]);
    expect(result[0].competitors[1].incomplete).toBe(false);
  });
});
