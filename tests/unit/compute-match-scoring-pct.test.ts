import { describe, expect, it } from "vitest";
import { computeMatchScoringPct } from "@/lib/match-data";

describe("computeMatchScoringPct", () => {
  it("returns 0 for null/undefined event", () => {
    expect(computeMatchScoringPct(null)).toBe(0);
    expect(computeMatchScoringPct(undefined)).toBe(0);
  });

  it("returns 0 for an event with no stages", () => {
    expect(computeMatchScoringPct({ stages: [] })).toBe(0);
    expect(computeMatchScoringPct({ stages: null })).toBe(0);
  });

  it("aggregates per-stage progress as scored / total across the match", () => {
    expect(
      computeMatchScoringPct({
        stages: [
          { scoring_progress: { scored: 30, total: 100 } },
          { scoring_progress: { scored: 50, total: 100 } },
          { scoring_progress: { scored: 20, total: 100 } },
        ],
      }),
    ).toBeCloseTo((100 / 300) * 100);
  });

  it("weights by stage size, not unweighted mean", () => {
    // Stage 1 has 5x more competitors than stage 2; the larger stage dominates.
    expect(
      computeMatchScoringPct({
        stages: [
          { scoring_progress: { scored: 0, total: 500 } },
          { scoring_progress: { scored: 100, total: 100 } },
        ],
      }),
    ).toBeCloseTo((100 / 600) * 100);
  });

  it("treats a fully scored match as 100", () => {
    expect(
      computeMatchScoringPct({
        stages: [
          { scoring_progress: { scored: 148, total: 148 } },
          { scoring_progress: { scored: 148, total: 148 } },
        ],
      }),
    ).toBe(100);
  });

  it("ignores stages without progress data", () => {
    expect(
      computeMatchScoringPct({
        stages: [
          { scoring_progress: null },
          { scoring_progress: undefined },
          { scoring_progress: { scored: 50, total: 100 } },
        ],
      }),
    ).toBe(50);
  });

  it("returns 0 when total is 0 across all stages", () => {
    expect(
      computeMatchScoringPct({
        stages: [
          { scoring_progress: { scored: 0, total: 0 } },
        ],
      }),
    ).toBe(0);
  });
});
