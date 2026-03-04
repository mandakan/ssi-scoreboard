import { describe, it, expect } from "vitest";
import {
  computeAggregateStats,
  linearRegressionSlope,
  computeAZonePct,
  computeMovingAverage,
  getMostFrequentDivision,
} from "@/lib/shooter-stats";
import type { ShooterMatchSummary } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<ShooterMatchSummary> = {}): ShooterMatchSummary {
  return {
    ct: "22",
    matchId: "1",
    name: "Test Match",
    date: "2026-01-01T08:00:00Z",
    venue: null,
    level: null,
    region: null,
    division: "Production",
    competitorId: 100,
    competitorsInDivision: 10,
    stageCount: 8,
    avgHF: 5.0,
    matchPct: 70.0,
    totalA: 80,
    totalC: 10,
    totalD: 5,
    totalMiss: 2,
    totalNoShoots: 0,
    ...overrides,
  };
}

// ─── linearRegressionSlope ───────────────────────────────────────────────────

describe("linearRegressionSlope", () => {
  it("returns null for fewer than 3 points", () => {
    expect(linearRegressionSlope([[0, 1], [1, 2]])).toBeNull();
    expect(linearRegressionSlope([])).toBeNull();
  });

  it("computes positive slope for increasing trend", () => {
    const slope = linearRegressionSlope([[0, 1], [1, 2], [2, 3]]);
    expect(slope).toBeCloseTo(1.0);
  });

  it("computes negative slope for decreasing trend", () => {
    const slope = linearRegressionSlope([[0, 6], [1, 4], [2, 2]]);
    expect(slope).toBeCloseTo(-2.0);
  });

  it("returns 0 for flat data", () => {
    const slope = linearRegressionSlope([[0, 5], [1, 5], [2, 5]]);
    expect(slope).toBeCloseTo(0);
  });

  it("returns null when all x values are the same", () => {
    expect(linearRegressionSlope([[1, 2], [1, 3], [1, 4]])).toBeNull();
  });
});

// ─── computeAZonePct ─────────────────────────────────────────────────────────

describe("computeAZonePct", () => {
  it("computes A-zone % from hit totals", () => {
    const match = makeMatch({ totalA: 80, totalC: 10, totalD: 5, totalMiss: 5 });
    expect(computeAZonePct(match)).toBeCloseTo(80.0);
  });

  it("returns null when no shots", () => {
    const match = makeMatch({ totalA: 0, totalC: 0, totalD: 0, totalMiss: 0 });
    expect(computeAZonePct(match)).toBeNull();
  });

  it("returns 100% when all A hits", () => {
    const match = makeMatch({ totalA: 50, totalC: 0, totalD: 0, totalMiss: 0 });
    expect(computeAZonePct(match)).toBeCloseTo(100.0);
  });

  it("returns 0% when no A hits", () => {
    const match = makeMatch({ totalA: 0, totalC: 10, totalD: 5, totalMiss: 3 });
    expect(computeAZonePct(match)).toBeCloseTo(0);
  });
});

// ─── computeMovingAverage ────────────────────────────────────────────────────

describe("computeMovingAverage", () => {
  it("returns nulls until window is filled", () => {
    const result = computeMovingAverage([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([null, null, 2, 3, 4]);
  });

  it("handles nulls in input", () => {
    const result = computeMovingAverage([1, null, 3, 4, 5], 3);
    // null in position 1 → null output; then buf has [1, 3] (only 2 non-null), so position 2 → null
    // position 3: buf [1, 3, 4] → 8/3 ≈ 2.667; position 4: buf [3, 4, 5] → 4
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[3]).toBeCloseTo(8 / 3);
    expect(result[4]).toBeCloseTo(4);
  });

  it("handles window of 1", () => {
    const result = computeMovingAverage([10, 20, 30], 1);
    expect(result).toEqual([10, 20, 30]);
  });

  it("returns empty for empty input", () => {
    expect(computeMovingAverage([], 3)).toEqual([]);
  });

  it("handles all nulls", () => {
    expect(computeMovingAverage([null, null, null], 2)).toEqual([null, null, null]);
  });
});

// ─── getMostFrequentDivision ─────────────────────────────────────────────────

describe("getMostFrequentDivision", () => {
  it("returns the most common division", () => {
    const matches = [
      makeMatch({ division: "Production" }),
      makeMatch({ division: "Open Major" }),
      makeMatch({ division: "Production" }),
      makeMatch({ division: "Production" }),
      makeMatch({ division: "Open Major" }),
    ];
    expect(getMostFrequentDivision(matches)).toBe("Production");
  });

  it("returns null when no divisions", () => {
    const matches = [
      makeMatch({ division: null }),
      makeMatch({ division: null }),
    ];
    expect(getMostFrequentDivision(matches)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(getMostFrequentDivision([])).toBeNull();
  });

  it("returns the single division when only one exists", () => {
    const matches = [makeMatch({ division: "Open Major" })];
    expect(getMostFrequentDivision(matches)).toBe("Open Major");
  });
});

// ─── computeAggregateStats ───────────────────────────────────────────────────

describe("computeAggregateStats", () => {
  it("computes stats for multiple matches", () => {
    const matches = [
      makeMatch({ date: "2026-03-01T08:00:00Z", avgHF: 6.0, matchPct: 80.0, stageCount: 10 }),
      makeMatch({ date: "2026-02-01T08:00:00Z", avgHF: 4.0, matchPct: 60.0, stageCount: 8 }),
    ];
    const stats = computeAggregateStats(matches);

    expect(stats.totalStages).toBe(18);
    expect(stats.dateRange.from).toBe("2026-02-01T08:00:00Z");
    expect(stats.dateRange.to).toBe("2026-03-01T08:00:00Z");
    // Weighted mean HF: (6*10 + 4*8) / (10+8) = 92/18 ≈ 5.111
    expect(stats.overallAvgHF).toBeCloseTo(92 / 18);
    // Mean match pct: (80+60)/2 = 70
    expect(stats.overallMatchPct).toBeCloseTo(70);
  });

  it("handles empty matches array", () => {
    const stats = computeAggregateStats([]);
    expect(stats.totalStages).toBe(0);
    expect(stats.overallAvgHF).toBeNull();
    expect(stats.overallMatchPct).toBeNull();
    expect(stats.aPercent).toBeNull();
    expect(stats.hfTrendSlope).toBeNull();
  });

  it("computes accuracy percentages", () => {
    const matches = [
      makeMatch({ totalA: 100, totalC: 20, totalD: 10, totalMiss: 5 }),
    ];
    const stats = computeAggregateStats(matches);
    // Total = 135
    expect(stats.aPercent).toBeCloseTo((100 / 135) * 100);
    expect(stats.cPercent).toBeCloseTo((20 / 135) * 100);
  });

  it("computes HF trend slope with 3+ matches", () => {
    const matches = [
      makeMatch({ date: "2026-03-01T08:00:00Z", avgHF: 7.0 }),
      makeMatch({ date: "2026-02-01T08:00:00Z", avgHF: 6.0 }),
      makeMatch({ date: "2026-01-01T08:00:00Z", avgHF: 5.0 }),
    ];
    const stats = computeAggregateStats(matches);
    // Chronological order: 5, 6, 7 → positive slope
    expect(stats.hfTrendSlope).not.toBeNull();
    expect(stats.hfTrendSlope!).toBeGreaterThan(0);
  });

  it("handles matches with null avgHF and matchPct", () => {
    const matches = [
      makeMatch({ avgHF: null, matchPct: null }),
      makeMatch({ avgHF: 5.0, matchPct: 70.0 }),
    ];
    const stats = computeAggregateStats(matches);
    expect(stats.overallAvgHF).toBeCloseTo(5.0);
    expect(stats.overallMatchPct).toBeCloseTo(70.0);
  });

  it("computes consistency CV for 2+ matches", () => {
    const matches = [
      makeMatch({ avgHF: 5.0 }),
      makeMatch({ avgHF: 5.0 }),
    ];
    const stats = computeAggregateStats(matches);
    // Identical HFs → CV = 0
    expect(stats.consistencyCV).toBeCloseTo(0);
  });
});
