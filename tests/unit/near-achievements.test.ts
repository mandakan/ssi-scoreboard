import { describe, it, expect } from "vitest";
import { computeNearAchievements } from "@/lib/achievements/near";
import type { AchievementProgress } from "@/lib/achievements/types";

function makeProgress(overrides: Partial<AchievementProgress> = {}): AchievementProgress {
  return {
    definition: {
      id: "match-count",
      name: "Competitor",
      description: "Test achievement",
      category: "milestone",
      icon: "trophy",
      tiers: [
        { level: 1, name: "First", threshold: 1, label: "1 match" },
        { level: 2, name: "Regular", threshold: 5, label: "5 matches" },
        { level: 3, name: "Veteran", threshold: 10, label: "10 matches" },
      ],
    },
    currentValue: 7,
    unlockedTiers: [
      { level: 1, unlockedAt: "2024-01-01", matchRef: null, value: 1 },
      { level: 2, unlockedAt: "2024-06-01", matchRef: null, value: 5 },
    ],
    nextTier: { level: 3, name: "Veteran", threshold: 10, label: "10 matches" },
    progressToNext: 0.4,
    ...overrides,
  };
}

function makeMaxed(): AchievementProgress {
  return makeProgress({
    currentValue: 10,
    nextTier: null,
    progressToNext: 1,
    unlockedTiers: [
      { level: 1, unlockedAt: "2024-01-01", matchRef: null, value: 1 },
      { level: 2, unlockedAt: "2024-06-01", matchRef: null, value: 5 },
      { level: 3, unlockedAt: "2025-01-01", matchRef: null, value: 10 },
    ],
  });
}

describe("computeNearAchievements", () => {
  it("returns empty for empty input", () => {
    expect(computeNearAchievements([])).toEqual([]);
  });

  it("returns empty when all achievements are maxed", () => {
    expect(computeNearAchievements([makeMaxed(), makeMaxed()])).toEqual([]);
  });

  it("returns empty when all have progressToNext below threshold (< 0.25)", () => {
    const far = makeProgress({ progressToNext: 0.1 });
    expect(computeNearAchievements([far])).toEqual([]);
  });

  it("includes achievements with progressToNext exactly at threshold (0.25)", () => {
    const borderline = makeProgress({ progressToNext: 0.25 });
    const result = computeNearAchievements([borderline]);
    expect(result).toHaveLength(1);
  });

  it("excludes achievements with progressToNext just below threshold (0.249)", () => {
    const nearMiss = makeProgress({ progressToNext: 0.249 });
    expect(computeNearAchievements([nearMiss])).toHaveLength(0);
  });

  it("caps at 3 results", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      makeProgress({
        definition: {
          id: `achievement-${i}`,
          name: `Achievement ${i}`,
          description: "",
          category: "milestone",
          icon: "trophy",
          tiers: [{ level: 1, name: "Tier", threshold: 10, label: "10 matches" }],
        },
        progressToNext: 0.3 + i * 0.05,
      }),
    );
    expect(computeNearAchievements(many)).toHaveLength(3);
  });

  it("sorts by highest progressToNext first (closest first)", () => {
    const a = makeProgress({
      definition: { id: "a", name: "A", description: "", category: "milestone", icon: "trophy",
        tiers: [{ level: 1, name: "T", threshold: 10, label: "10 matches" }] },
      progressToNext: 0.3,
    });
    const b = makeProgress({
      definition: { id: "b", name: "B", description: "", category: "milestone", icon: "trophy",
        tiers: [{ level: 1, name: "T", threshold: 10, label: "10 matches" }] },
      progressToNext: 0.9,
    });
    const c = makeProgress({
      definition: { id: "c", name: "C", description: "", category: "milestone", icon: "trophy",
        tiers: [{ level: 1, name: "T", threshold: 10, label: "10 matches" }] },
      progressToNext: 0.6,
    });
    const result = computeNearAchievements([a, b, c]);
    expect(result.map((r) => r.progress.definition.id)).toEqual(["b", "c", "a"]);
  });

  it("computes remaining correctly", () => {
    const p = makeProgress({
      currentValue: 7,
      nextTier: { level: 3, name: "Veteran", threshold: 10, label: "10 matches" },
      progressToNext: 0.4,
    });
    const result = computeNearAchievements([p]);
    expect(result[0].remaining).toBe(3);
  });

  it("generates nudge with unit from label", () => {
    const p = makeProgress({
      currentValue: 7,
      nextTier: { level: 3, name: "Veteran", threshold: 10, label: "10 matches" },
      progressToNext: 0.4,
    });
    const result = computeNearAchievements([p]);
    expect(result[0].nudge).toBe("3 more matches");
  });

  it("nudge uses unit from label with multiple words", () => {
    const p = makeProgress({
      definition: {
        id: "globe-trotter",
        name: "Globe Trotter",
        description: "",
        category: "variety",
        icon: "globe",
        tiers: [{ level: 1, name: "Traveller", threshold: 3, label: "3 countries" }],
      },
      currentValue: 2,
      nextTier: { level: 1, name: "Traveller", threshold: 3, label: "3 countries" },
      progressToNext: 0.5,
      unlockedTiers: [],
    });
    const result = computeNearAchievements([p]);
    expect(result[0].nudge).toBe("1 more countries");
  });

  it("exposes the full AchievementProgress on each result", () => {
    const p = makeProgress();
    const result = computeNearAchievements([p]);
    expect(result[0].progress).toBe(p);
  });

  it("mixed maxed + near + far: only returns near", () => {
    const near = makeProgress({ progressToNext: 0.7 });
    const maxed = makeMaxed();
    const far = makeProgress({ progressToNext: 0.1 });
    const result = computeNearAchievements([near, maxed, far]);
    expect(result).toHaveLength(1);
    expect(result[0].progress).toBe(near);
  });
});
