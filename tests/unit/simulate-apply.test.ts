import { describe, it, expect } from "vitest";
import { applyAdjustmentsToScorecards } from "@/lib/simulate-apply";
import type { RawScorecard } from "@/app/api/compare/logic";
import type { StageSimulatorAdjustments } from "@/lib/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeScorecard(overrides: Partial<RawScorecard> = {}): RawScorecard {
  return {
    competitor_id: 1,
    competitor_division: "Open Major",
    stage_id: 1,
    stage_number: 1,
    stage_name: "Stage 1",
    max_points: 100,
    points: 80,
    hit_factor: 8.0,
    time: 10.0,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 10,
    c_hits: 4,
    d_hits: 2,
    miss_count: 1,
    no_shoots: 1,
    procedurals: 1,
    ...overrides,
  };
}

const noAdj: StageSimulatorAdjustments = {
  timeDelta: 0, missToACount: 0, missToCCount: 0,
  nsToACount: 0, nsToCCount: 0, cToACount: 0,
  dToACount: 0, dToCCount: 0, removedProcedurals: 0,
  aToCCount: 0, aToMissCount: 0, aToNSCount: 0,
};

// ─── applyAdjustmentsToScorecards ─────────────────────────────────────────────

describe("applyAdjustmentsToScorecards", () => {
  it("returns unchanged scorecards with no adjustments", () => {
    const sc = makeScorecard();
    const result = applyAdjustmentsToScorecards([sc], 1, "Open Major", { 1: noAdj });
    expect(result[0]).toEqual(sc);
  });

  it("does not mutate the input array", () => {
    const sc = makeScorecard();
    const input = [sc];
    applyAdjustmentsToScorecards(input, 1, "Open Major", { 1: { ...noAdj, timeDelta: -1 } });
    expect(input[0].time).toBe(10.0); // original unchanged
  });

  it("only modifies the target competitor", () => {
    const sc1 = makeScorecard({ competitor_id: 1 });
    const sc2 = makeScorecard({ competitor_id: 2, points: 70, hit_factor: 7.0 });
    const result = applyAdjustmentsToScorecards(
      [sc1, sc2], 1, "Open Major", { 1: { ...noAdj, timeDelta: -2 } }
    );
    expect(result[0].time).toBe(8.0);
    expect(result[1].time).toBe(10.0); // unchanged
  });

  it("applies time delta and recomputes hit_factor", () => {
    const sc = makeScorecard({ points: 80, time: 10.0 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, timeDelta: -2 } }
    );
    expect(result[0].time).toBeCloseTo(8.0, 5);
    expect(result[0].hit_factor).toBeCloseTo(80 / 8.0, 5);
  });

  it("constrains time to minimum 0.001", () => {
    const sc = makeScorecard({ time: 5.0 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, timeDelta: -100 } }
    );
    expect(result[0].time).toBeGreaterThanOrEqual(0.001);
  });

  it("miss→A: adds +15 pts major, updates zone counts", () => {
    const sc = makeScorecard({ points: 70, time: 10.0, a_hits: 8, miss_count: 2 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, missToACount: 1 } }
    );
    expect(result[0].points).toBe(85);
    expect(result[0].a_hits).toBe(9);
    expect(result[0].miss_count).toBe(1);
  });

  it("miss→C: adds +14 pts major, updates zone counts", () => {
    const sc = makeScorecard({ points: 70, time: 10.0, c_hits: 3, miss_count: 2 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, missToCCount: 1 } }
    );
    expect(result[0].points).toBe(84);
    expect(result[0].c_hits).toBe(4);
    expect(result[0].miss_count).toBe(1);
  });

  it("miss→C: adds +13 pts minor, updates zone counts", () => {
    const sc = makeScorecard({ competitor_division: "Production", points: 70, time: 10.0, c_hits: 3, miss_count: 2 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Production", { 1: { ...noAdj, missToCCount: 1 } }
    );
    expect(result[0].points).toBe(83);
    expect(result[0].c_hits).toBe(4);
    expect(result[0].miss_count).toBe(1);
  });

  it("D→A: adds +3 pts major, updates zone counts", () => {
    const sc = makeScorecard({ points: 74, time: 10.0, a_hits: 10, d_hits: 3 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, dToACount: 2 } }
    );
    expect(result[0].points).toBe(80); // +6 pts (2 × 3)
    expect(result[0].a_hits).toBe(12);
    expect(result[0].d_hits).toBe(1);
  });

  it("D→A: adds +4 pts minor, updates zone counts", () => {
    const sc = makeScorecard({ competitor_division: "Production", points: 72, time: 10.0, a_hits: 10, d_hits: 3 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Production", { 1: { ...noAdj, dToACount: 2 } }
    );
    expect(result[0].points).toBe(80); // +8 pts (2 × 4)
    expect(result[0].a_hits).toBe(12);
    expect(result[0].d_hits).toBe(1);
  });

  it("D→C: adds +2 pts for both major and minor, updates zone counts", () => {
    const sc = makeScorecard({ points: 76, time: 10.0, c_hits: 2, d_hits: 3 });
    const resultMajor = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, dToCCount: 2 } }
    );
    expect(resultMajor[0].points).toBe(80); // +4 pts (2 × 2)
    expect(resultMajor[0].c_hits).toBe(4);
    expect(resultMajor[0].d_hits).toBe(1);

    const resultMinor = applyAdjustmentsToScorecards(
      [sc], 1, "Production", { 1: { ...noAdj, dToCCount: 2 } }
    );
    expect(resultMinor[0].points).toBe(80); // +4 pts (same for minor)
  });

  it("procedural removal: adds +10 pts, updates procedurals count", () => {
    const sc = makeScorecard({ points: 60, time: 10.0, procedurals: 3 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, removedProcedurals: 2 } }
    );
    expect(result[0].points).toBe(80); // +20 pts (2 × 10)
    expect(result[0].procedurals).toBe(1);
  });

  it("C→A: adds +1 pt major, updates zone counts", () => {
    const sc = makeScorecard({ points: 78, time: 10.0, a_hits: 8, c_hits: 4 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, cToACount: 2 } }
    );
    expect(result[0].points).toBe(80); // +2 pts (2 × 1)
    expect(result[0].a_hits).toBe(10);
    expect(result[0].c_hits).toBe(2);
  });

  it("skips stages not in the adjustments map", () => {
    const sc1 = makeScorecard({ stage_id: 1, points: 80 });
    const sc2 = makeScorecard({ stage_id: 2, points: 60, time: 10.0 });
    const result = applyAdjustmentsToScorecards(
      [sc1, sc2], 1, "Open Major", { 1: { ...noAdj, timeDelta: -2 } }
    );
    // Stage 1 is modified, stage 2 is untouched
    expect(result[0].time).toBe(8.0);
    expect(result[1].time).toBe(10.0);
  });

  it("recomputes hit_factor after point and time changes", () => {
    const sc = makeScorecard({ points: 70, time: 10.0, miss_count: 1 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, missToACount: 1, timeDelta: -1 } }
    );
    const expectedPoints = 85; // +15 pts
    const expectedTime = 9.0;
    const expectedHF = expectedPoints / expectedTime;
    expect(result[0].points).toBeCloseTo(expectedPoints, 5);
    expect(result[0].time).toBeCloseTo(expectedTime, 5);
    expect(result[0].hit_factor).toBeCloseTo(expectedHF, 5);
  });

  it("A→C: subtracts −1 pt major, updates zone counts", () => {
    const sc = makeScorecard({ points: 80, time: 10.0, a_hits: 10, c_hits: 4 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, aToCCount: 2 } }
    );
    expect(result[0].points).toBe(78); // −2 pts (2 × 1)
    expect(result[0].a_hits).toBe(8);
    expect(result[0].c_hits).toBe(6);
  });

  it("A→C: subtracts −2 pts minor, updates zone counts", () => {
    const sc = makeScorecard({ points: 80, time: 10.0, a_hits: 10, c_hits: 4,
      competitor_division: "Production" });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Production", { 1: { ...noAdj, aToCCount: 2 } }
    );
    expect(result[0].points).toBe(76); // −4 pts (2 × 2)
    expect(result[0].a_hits).toBe(8);
    expect(result[0].c_hits).toBe(6);
  });

  it("A→Miss: subtracts −15 pts, updates zone counts", () => {
    const sc = makeScorecard({ points: 80, time: 10.0, a_hits: 10, miss_count: 1 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, aToMissCount: 1 } }
    );
    expect(result[0].points).toBe(65); // −15 pts
    expect(result[0].a_hits).toBe(9);
    expect(result[0].miss_count).toBe(2);
  });

  it("A→NS: subtracts −15 pts, updates zone counts", () => {
    const sc = makeScorecard({ points: 80, time: 10.0, a_hits: 10, no_shoots: 0 });
    const result = applyAdjustmentsToScorecards(
      [sc], 1, "Open Major", { 1: { ...noAdj, aToNSCount: 2 } }
    );
    expect(result[0].points).toBe(50); // −30 pts
    expect(result[0].a_hits).toBe(8);
    expect(result[0].no_shoots).toBe(2);
  });
});
