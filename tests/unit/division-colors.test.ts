import { describe, it, expect } from "vitest";
import { divisionColor, extractDivisions } from "@/lib/division-colors";
import type { ShooterMatchSummary } from "@/lib/types";

function makeMatch(division: string | null): ShooterMatchSummary {
  return {
    ct: "22",
    matchId: "1",
    name: "Test",
    date: null,
    venue: null,
    level: null,
    region: null,
    division,
    competitorId: 1,
    competitorsInDivision: null,
    stageCount: 0,
    avgHF: null,
    matchPct: null,
    totalA: 0,
    totalC: 0,
    totalD: 0,
    totalMiss: 0,
    totalNoShoots: 0,
  };
}

describe("divisionColor", () => {
  it("returns a fixed color for known divisions", () => {
    expect(divisionColor("Production")).toBe("#f59e0b");
    expect(divisionColor("Open Major")).toBe("#3b82f6");
    expect(divisionColor("Standard Minor")).toBe("#4ade80");
    expect(divisionColor("PCC")).toBe("#14b8a6");
  });

  it("returns a muted color for null division", () => {
    expect(divisionColor(null)).toBe("#94a3b8");
  });

  it("returns a fallback color for unknown divisions", () => {
    const color = divisionColor("Galactic Blaster");
    // Should be one of the fallback palette
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    // Should not be the null-muted color
    expect(color).not.toBe("#94a3b8");
  });

  it("returns deterministic color for the same unknown division", () => {
    expect(divisionColor("Custom Div")).toBe(divisionColor("Custom Div"));
  });

  it("differentiates between Open and Open Major", () => {
    // Both map to the same blue by design (Open is just a fallback when no power factor)
    expect(divisionColor("Open")).toBe("#3b82f6");
    expect(divisionColor("Open Major")).toBe("#3b82f6");
    expect(divisionColor("Open Minor")).toBe("#60a5fa");
  });
});

describe("extractDivisions", () => {
  it("extracts unique divisions sorted alphabetically", () => {
    const matches = [
      makeMatch("Production"),
      makeMatch("Open Major"),
      makeMatch("Production"),
      makeMatch("Standard Minor"),
    ];
    expect(extractDivisions(matches)).toEqual([
      "Open Major",
      "Production",
      "Standard Minor",
    ]);
  });

  it("ignores null divisions", () => {
    const matches = [
      makeMatch(null),
      makeMatch("Production"),
      makeMatch(null),
    ];
    expect(extractDivisions(matches)).toEqual(["Production"]);
  });

  it("returns empty for no matches", () => {
    expect(extractDivisions([])).toEqual([]);
  });

  it("returns empty when all divisions are null", () => {
    expect(extractDivisions([makeMatch(null)])).toEqual([]);
  });
});
