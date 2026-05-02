import { describe, expect, it } from "vitest";
import { effectiveMatchScoringPct } from "@/lib/match-data";

describe("effectiveMatchScoringPct", () => {
  it("returns 0 for null/undefined event", () => {
    expect(effectiveMatchScoringPct(null)).toBe(0);
    expect(effectiveMatchScoringPct(undefined)).toBe(0);
  });

  it("trusts the match-level value when stages agree", () => {
    expect(
      effectiveMatchScoringPct({
        scoring_completed: "57.0",
        stages: [
          { scoring_completed: "55" },
          { scoring_completed: "60" },
          { scoring_completed: "56" },
        ],
      }),
    ).toBeCloseTo(57);
  });

  it("falls back to stage mean when match-level reports 0 but stages have scoring", () => {
    // SPSK Open 2026 (match 22/27190) shape: SSI returned scoring_completed="0"
    // for the match while every stage independently reported 21-29%.
    expect(
      effectiveMatchScoringPct({
        scoring_completed: "0",
        stages: [
          { scoring_completed: "29.487179487179485" },
          { scoring_completed: "28.846153846153847" },
          { scoring_completed: "21.153846153846153" },
        ],
      }),
    ).toBeCloseTo((29.4872 + 28.8462 + 21.1538) / 3, 2);
  });

  it("absorbs <=1pp slack between match and stage mean (no flap)", () => {
    expect(
      effectiveMatchScoringPct({
        scoring_completed: "55",
        stages: [
          { scoring_completed: "55.5" },
          { scoring_completed: "55.5" },
        ],
      }),
    ).toBe(55);
  });

  it("ignores stages without scoring_completed", () => {
    expect(
      effectiveMatchScoringPct({
        scoring_completed: "0",
        stages: [
          { scoring_completed: null },
          { scoring_completed: undefined },
        ],
      }),
    ).toBe(0);
  });

  it("returns the match value when stages array is empty", () => {
    expect(
      effectiveMatchScoringPct({
        scoring_completed: "42.5",
        stages: [],
      }),
    ).toBeCloseTo(42.5);
  });

  it("handles numeric scoring_completed without parseFloat surprises", () => {
    expect(
      effectiveMatchScoringPct({
        scoring_completed: 0,
        stages: [{ scoring_completed: 30 }, { scoring_completed: 40 }],
      }),
    ).toBe(35);
  });
});
