import { describe, expect, it } from "vitest";
import { analysisCompareMode, initialAnalysisSelection } from "@/lib/analysis-selection";
import { MAX_COMPETITORS } from "@/lib/constants";
import type { MatchResponse } from "@/lib/types";

describe("initialAnalysisSelection", () => {
  it("prefers the URL", () => {
    expect(initialAnalysisSelection({ urlIds: [1], savedIds: [2], gridRows: [3] }))
      .toEqual({ ids: [1], seeded: false });
  });
  it("falls back to the saved selection", () => {
    expect(initialAnalysisSelection({ urlIds: [], savedIds: [2], gridRows: [3] }))
      .toEqual({ ids: [2], seeded: false });
  });
  it("seeds from grid rows, capped, and flags it", () => {
    const rows = Array.from({ length: 20 }, (_, i) => i + 1);
    const r = initialAnalysisSelection({ urlIds: [], savedIds: [], gridRows: rows });
    expect(r.ids).toEqual(rows.slice(0, MAX_COMPETITORS));
    expect(r.seeded).toBe(true);
  });
  it("is empty and unseeded when there is nothing", () => {
    expect(initialAnalysisSelection({ urlIds: [], savedIds: [], gridRows: [] }))
      .toEqual({ ids: [], seeded: false });
  });
});

describe("analysisCompareMode", () => {
  const base = {
    scoring_pct: 50, results_status: "org", match_status: "on",
    date: new Date("2026-09-28T08:00:00Z").toISOString(), ends: null,
  } as unknown as MatchResponse;
  const now = new Date("2026-09-28T12:00:00Z").getTime();

  it("is live while scoring is under way", () => {
    expect(analysisCompareMode(base, now)).toBe("live");
  });
  it("is coaching once results are published", () => {
    expect(analysisCompareMode({ ...base, results_status: "all" } as MatchResponse, now)).toBe("coaching");
  });
  it("is live (not prematch) before scoring starts", () => {
    expect(analysisCompareMode({ ...base, scoring_pct: 0 } as MatchResponse, now)).toBe("live");
  });
});
