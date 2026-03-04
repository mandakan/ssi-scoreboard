import { describe, it, expect } from "vitest";
import { evaluateAchievements } from "@/lib/achievements/evaluate";
import type {
  AchievementEvalContext,
  StoredAchievement,
} from "@/lib/achievements/types";
import type { ShooterMatchSummary, ShooterAggregateStats } from "@/lib/types";

function makeMatch(overrides: Partial<ShooterMatchSummary> = {}): ShooterMatchSummary {
  return {
    ct: "22",
    matchId: "1",
    name: "Test Match",
    date: "2025-01-01T00:00:00Z",
    venue: null,
    level: "Level II",
    region: null,
    division: "Production",
    competitorId: 100,
    competitorsInDivision: 10,
    stageCount: 6,
    avgHF: 5.0,
    matchPct: 75,
    totalA: 80,
    totalC: 10,
    totalD: 5,
    totalMiss: 3,
    totalNoShoots: 2,
    perfectStages: 0,
    ...overrides,
  };
}

function makeStats(overrides: Partial<ShooterAggregateStats> = {}): ShooterAggregateStats {
  return {
    totalStages: 6,
    dateRange: { from: "2025-01-01", to: "2025-01-01" },
    overallAvgHF: 5.0,
    overallMatchPct: 75,
    aPercent: 80,
    cPercent: 10,
    dPercent: 5,
    missPercent: 3,
    consistencyCV: 0.1,
    hfTrendSlope: 0.01,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AchievementEvalContext> = {}): AchievementEvalContext {
  return {
    matchCount: 1,
    matches: [makeMatch()],
    stats: makeStats(),
    ...overrides,
  };
}

describe("evaluateAchievements", () => {
  it("returns no unlocks for zero matches", () => {
    const ctx = makeCtx({
      matchCount: 0,
      matches: [],
      stats: makeStats({ totalStages: 0, aPercent: null }),
    });
    const { achievements, newUnlocks } = evaluateAchievements(ctx, []);

    // All achievements should exist but none should have unlocked tiers
    expect(achievements.length).toBe(5);
    expect(newUnlocks.length).toBe(0);
    for (const a of achievements) {
      expect(a.unlockedTiers).toHaveLength(0);
      expect(a.nextTier).not.toBeNull();
    }
  });

  it("unlocks First Match tier for 1 match", () => {
    const ctx = makeCtx({ matchCount: 1 });
    const { achievements, newUnlocks } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.unlockedTiers).toHaveLength(1);
    expect(matchCountAch.unlockedTiers[0].level).toBe(1);
    expect(matchCountAch.nextTier?.threshold).toBe(5);

    // Should be in newUnlocks
    expect(newUnlocks.some((u) => u.achievementId === "match-count" && u.tier === 1)).toBe(true);
  });

  it("unlocks multiple sharpshooter tiers at 75% A-zone", () => {
    const ctx = makeCtx({
      stats: makeStats({ aPercent: 75 }),
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const sharpshooter = achievements.find((a) => a.definition.id === "sharpshooter")!;
    expect(sharpshooter.unlockedTiers).toHaveLength(2); // 60% and 70%
    expect(sharpshooter.nextTier?.threshold).toBe(80);
  });

  it("does not re-emit stored tiers as new unlocks", () => {
    const ctx = makeCtx({ matchCount: 5 });
    const stored: StoredAchievement[] = [
      {
        achievementId: "match-count",
        tier: 1,
        unlockedAt: "2025-01-01T00:00:00Z",
        matchRef: null,
        value: 1,
      },
    ];
    const { achievements, newUnlocks } = evaluateAchievements(ctx, stored);

    // tier 1 should be unlocked but NOT in newUnlocks
    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.unlockedTiers).toHaveLength(2); // tier 1 (stored) + tier 2 (new)
    expect(newUnlocks.find((u) => u.achievementId === "match-count" && u.tier === 1)).toBeUndefined();
    expect(newUnlocks.find((u) => u.achievementId === "match-count" && u.tier === 2)).toBeDefined();
  });

  it("computes correct progress to next tier", () => {
    const ctx = makeCtx({ matchCount: 3 });
    const { achievements } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    // Between tier 1 (threshold=1) and tier 2 (threshold=5), at value=3
    // progress = (3-1)/(5-1) = 0.5
    expect(matchCountAch.progressToNext).toBeCloseTo(0.5);
  });

  it("returns nextTier=null and progress=1 when all tiers complete", () => {
    const ctx = makeCtx({ matchCount: 100 });
    const { achievements } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.nextTier).toBeNull();
    expect(matchCountAch.progressToNext).toBe(1);
  });

  it("counts perfect stages from matches", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ perfectStages: 2 }),
        makeMatch({ matchId: "2", perfectStages: 3 }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const perfectAch = achievements.find((a) => a.definition.id === "perfect-stages")!;
    expect(perfectAch.currentValue).toBe(5);
    expect(perfectAch.unlockedTiers).toHaveLength(2); // 1 and 5
  });

  it("counts clean matches correctly", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ totalMiss: 0, totalNoShoots: 0 }),
        makeMatch({ matchId: "2", totalMiss: 1, totalNoShoots: 0 }),
        makeMatch({ matchId: "3", totalMiss: 0, totalNoShoots: 0 }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const cleanAch = achievements.find((a) => a.definition.id === "clean-match")!;
    expect(cleanAch.currentValue).toBe(2);
    expect(cleanAch.unlockedTiers).toHaveLength(1); // threshold 1
  });

  it("evaluates stage-count from stats.totalStages", () => {
    const ctx = makeCtx({
      stats: makeStats({ totalStages: 55 }),
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const stageAch = achievements.find((a) => a.definition.id === "stage-count")!;
    expect(stageAch.currentValue).toBe(55);
    expect(stageAch.unlockedTiers).toHaveLength(2); // 10 and 50
    expect(stageAch.nextTier?.threshold).toBe(100);
  });
});
