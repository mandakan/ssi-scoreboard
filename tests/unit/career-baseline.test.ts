import { describe, it, expect } from "vitest";
import { computeCareerBaseline } from "@/lib/career-baseline";
import type { ShooterMatchSummary } from "@/lib/types";

function makeMatch(overrides: Partial<ShooterMatchSummary> = {}): ShooterMatchSummary {
  return {
    ct: "22",
    matchId: "100",
    name: "Test Match",
    date: "2025-01-01",
    venue: null,
    level: "l2",
    region: null,
    division: "Production Optics",
    competitorId: 1,
    competitorsInDivision: 10,
    stageCount: 5,
    avgHF: 3.5,
    matchPct: 80,
    totalA: 50,
    totalC: 5,
    totalD: 2,
    totalMiss: 0,
    totalNoShoots: 0,
    ...overrides,
  };
}

function makeMatches(avgHFs: (number | null)[], matchPcts: (number | null)[]): ShooterMatchSummary[] {
  return avgHFs.map((avgHF, i) => makeMatch({ matchId: String(i), avgHF, matchPct: matchPcts[i] }));
}

describe("computeCareerBaseline", () => {
  it("returns null for both when input is empty", () => {
    expect(computeCareerBaseline([])).toEqual({ medianHF: null, medianMatchPct: null });
  });

  it("returns null when fewer than minMatches valid HF values", () => {
    const matches = makeMatches([3.0, 3.5, 4.0, 3.2], [80, 82, 85, 78]);
    const result = computeCareerBaseline(matches); // default minMatches=5
    expect(result.medianHF).toBeNull();
    expect(result.medianMatchPct).toBeNull();
  });

  it("returns values when exactly minMatches valid values", () => {
    const matches = makeMatches([3.0, 3.5, 4.0, 3.2, 3.8], [80, 82, 85, 78, 84]);
    const result = computeCareerBaseline(matches);
    expect(result.medianHF).not.toBeNull();
    expect(result.medianMatchPct).not.toBeNull();
  });

  it("computes correct median for odd count", () => {
    const matches = makeMatches([1.0, 3.0, 5.0, 2.0, 4.0], [60, 80, 100, 70, 90]);
    const result = computeCareerBaseline(matches);
    expect(result.medianHF).toBe(3.0); // sorted: 1, 2, 3, 4, 5 → middle = 3
    expect(result.medianMatchPct).toBe(80); // sorted: 60, 70, 80, 90, 100 → middle = 80
  });

  it("computes correct median for even count", () => {
    const matches = makeMatches([1.0, 2.0, 3.0, 4.0, 5.0, 6.0], [60, 70, 80, 90, 100, 110]);
    const result = computeCareerBaseline(matches);
    expect(result.medianHF).toBe(3.5); // sorted: 1,2,3,4,5,6 → (3+4)/2
    expect(result.medianMatchPct).toBe(85); // sorted: 60,70,80,90,100,110 → (80+90)/2
  });

  it("excludes null and zero avgHF values from median", () => {
    const matches = makeMatches([null, 0, 3.0, 3.5, 4.0, 3.2, 3.8], [80, 80, 80, 82, 85, 78, 84]);
    const result = computeCareerBaseline(matches); // 5 valid HF values (null and 0 excluded)
    expect(result.medianHF).not.toBeNull();
  });

  it("excludes null and zero matchPct from median", () => {
    const matches = makeMatches([3.0, 3.5, 4.0, 3.2, 3.8], [null, 0, 85, 78, 84]);
    const result = computeCareerBaseline(matches, 3); // only 3 valid pct values
    expect(result.medianMatchPct).not.toBeNull();
  });

  it("respects custom minMatches argument", () => {
    const matches = makeMatches([3.0, 3.5, 4.0], [80, 82, 85]);
    const resultDefault = computeCareerBaseline(matches); // needs 5
    const resultCustom = computeCareerBaseline(matches, 3); // needs 3
    expect(resultDefault.medianHF).toBeNull();
    expect(resultCustom.medianHF).toBe(3.5); // median of [3.0, 3.5, 4.0]
  });

  it("medianHF and medianMatchPct are independent", () => {
    // Only 4 HF values, 6 pct values
    const matches = [
      makeMatch({ matchId: "1", avgHF: 3.0, matchPct: 80 }),
      makeMatch({ matchId: "2", avgHF: null, matchPct: 82 }),
      makeMatch({ matchId: "3", avgHF: 4.0, matchPct: 85 }),
      makeMatch({ matchId: "4", avgHF: 3.5, matchPct: 78 }),
      makeMatch({ matchId: "5", avgHF: null, matchPct: 84 }),
      makeMatch({ matchId: "6", avgHF: 3.2, matchPct: 90 }),
    ];
    const result = computeCareerBaseline(matches); // 4 HF (< 5), 6 pct (>= 5)
    expect(result.medianHF).toBeNull();
    expect(result.medianMatchPct).not.toBeNull();
  });
});
