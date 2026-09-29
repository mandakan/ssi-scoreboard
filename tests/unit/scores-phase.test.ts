import { describe, expect, it } from "vitest";
import { matchScoresPhase } from "@/lib/scores-phase";
import type { MatchResponse } from "@/lib/types";

const now = new Date("2026-09-28T12:00:00Z").getTime();
const base = {
  scoring_pct: 50, results_status: "org", match_status: "on",
  date: new Date("2026-09-28T08:00:00Z").toISOString(), ends: null,
} as unknown as MatchResponse;
const m = (o: Partial<Record<string, unknown>>) => ({ ...base, ...o }) as unknown as MatchResponse;

describe("matchScoresPhase", () => {
  it("is prematch at 0% scored", () => {
    expect(matchScoresPhase(m({ scoring_pct: 0 }), now)).toBe("prematch");
  });
  it("is prematch under 25% inside the match window", () => {
    expect(matchScoresPhase(m({ scoring_pct: 10 }), now)).toBe("prematch");
  });
  it("is live once scoring is meaningfully under way", () => {
    expect(matchScoresPhase(base, now)).toBe("live");
  });
  it("is complete once results are published", () => {
    expect(matchScoresPhase(m({ results_status: "all" }), now)).toBe("complete");
  });
});
