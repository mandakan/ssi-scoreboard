import { describe, it, expect } from "vitest";
import { detectMatchView, isPreMatchEligible } from "@/lib/mode";

const baseArgs = {
  scoringPct: 0,
  daysSinceMatchStart: 0,
  daysSinceMatchEnd: null,
  resultsStatus: "stg",
  matchStatus: "on",
  hasActualScores: false,
};

describe("detectMatchView", () => {
  // ── Coaching ──────────────────────────────────────────────────────────────
  it("returns 'coaching' when results_status === 'all'", () => {
    expect(detectMatchView({ ...baseArgs, resultsStatus: "all" })).toBe("coaching");
  });

  it("returns 'coaching' when match_status === 'cp' (completed)", () => {
    expect(detectMatchView({ ...baseArgs, matchStatus: "cp", scoringPct: 50 })).toBe("coaching");
  });

  it("returns 'coaching' at 95% scored", () => {
    expect(detectMatchView({ ...baseArgs, scoringPct: 95 })).toBe("coaching");
  });

  it("returns 'coaching' at 100% scored", () => {
    expect(detectMatchView({ ...baseArgs, scoringPct: 100 })).toBe("coaching");
  });

  it("returns 'coaching' when match ended > 3 days ago", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 0, daysSinceMatchEnd: 4 }),
    ).toBe("coaching");
  });

  it("requires start > 6 days ago when end date is null (3-day grace buffer)", () => {
    // No ends date and start 7 days ago → coaching
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 50, daysSinceMatchStart: 7 }),
    ).toBe("coaching");
  });

  it("does NOT auto-flip to coaching for a multi-day match with ends=null and start 4 days ago", () => {
    // Buffer keeps multi-day matches in the live tier even when ends is missing.
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 50, daysSinceMatchStart: 4 }),
    ).toBe("live");
  });

  // ── Cancelled ─────────────────────────────────────────────────────────────
  it("returns 'live' when match cancelled (so partial scores remain visible)", () => {
    expect(
      detectMatchView({ ...baseArgs, matchStatus: "cs", scoringPct: 30 }),
    ).toBe("live");
  });

  // ── Pre-match ─────────────────────────────────────────────────────────────
  it("returns 'prematch' when no scores at all and match active", () => {
    expect(detectMatchView({ ...baseArgs, scoringPct: 0, hasActualScores: false })).toBe("prematch");
  });

  it("returns 'prematch' for upcoming match (start in future)", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 0, daysSinceMatchStart: -2, daysSinceMatchEnd: -2 }),
    ).toBe("prematch");
  });

  it("returns 'prematch' early in match (< 25% scored, end still ahead) — RO-squad case", () => {
    expect(
      detectMatchView({
        ...baseArgs,
        scoringPct: 15,
        daysSinceMatchStart: 0,
        daysSinceMatchEnd: -1, // multi-day match, ends tomorrow
      }),
    ).toBe("prematch");
  });

  it("returns 'prematch' early in match with ends=null and start today", () => {
    expect(
      detectMatchView({
        ...baseArgs,
        scoringPct: 10,
        daysSinceMatchStart: 0.5,
        daysSinceMatchEnd: null,
      }),
    ).toBe("prematch");
  });

  it("falls through to 'live' once scoring crosses 25%", () => {
    expect(
      detectMatchView({
        ...baseArgs,
        scoringPct: 30,
        daysSinceMatchStart: 0,
        daysSinceMatchEnd: 0,
      }),
    ).toBe("live");
  });

  // ── Live ──────────────────────────────────────────────────────────────────
  it("returns 'live' for active match (50% scored, day 1)", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 50, daysSinceMatchStart: 1, daysSinceMatchEnd: 1 }),
    ).toBe("live");
  });

  it("returns 'live' just below threshold (94% scored, day 3)", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 94, daysSinceMatchStart: 3, daysSinceMatchEnd: 3 }),
    ).toBe("live");
  });

  it("returns 'live' once compare data shows scores even if scoring_completed reports 0", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 0, hasActualScores: true, daysSinceMatchEnd: 1 }),
    ).toBe("live");
  });

  it("returns 'coaching' at 3.01 days since end", () => {
    expect(
      detectMatchView({ ...baseArgs, scoringPct: 0, daysSinceMatchEnd: 3.01 }),
    ).toBe("coaching");
  });
});

describe("isPreMatchEligible", () => {
  const baseEligible = {
    scoringPct: 0,
    resultsStatus: "stg",
    matchStatus: "on",
  };

  it("offered while match is in progress", () => {
    expect(isPreMatchEligible(baseEligible)).toBe(true);
  });

  it("offered with 30% scoring (early squads done, my squad in afternoon)", () => {
    expect(
      isPreMatchEligible({ ...baseEligible, scoringPct: 30 }),
    ).toBe(true);
  });

  it("offered for old multi-day matches with partial scoring (no date gate)", () => {
    // The previous date-based gate wrongly hid pre-match for Level 3+ matches
    // whose match.date is several days in the past while late squads haven't shot.
    expect(
      isPreMatchEligible({ ...baseEligible, scoringPct: 60 }),
    ).toBe(true);
  });

  it("hidden once results are officially published", () => {
    expect(
      isPreMatchEligible({ ...baseEligible, resultsStatus: "all" }),
    ).toBe(false);
  });

  it("hidden once match is marked completed", () => {
    expect(
      isPreMatchEligible({ ...baseEligible, matchStatus: "cp" }),
    ).toBe(false);
  });

  it("hidden once scoring reaches 95%", () => {
    expect(
      isPreMatchEligible({ ...baseEligible, scoringPct: 95 }),
    ).toBe(false);
  });
});
