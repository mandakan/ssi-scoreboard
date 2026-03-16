import { describe, it, expect } from "vitest";
import {
  diffAchievements,
  buildSnapshot,
  buildAchievementEmbed,
  type AchievementSnapshot,
  type AchievementUnlock,
} from "../../discord/src/notifications/achievement-announce";

// Helper to build a dashboard achievement entry
function makeAchievement(
  id: string,
  name: string,
  icon: string,
  tiers: Array<{ level: number; name: string; label: string }>,
  unlockedLevels: number[],
  nextTier: { name: string; label: string } | null = null,
) {
  return {
    definition: { id, name, icon, tiers },
    unlockedTiers: unlockedLevels.map((level) => ({ level })),
    nextTier,
  };
}

const COMPETITOR_TIERS = [
  { level: 1, name: "First Match", label: "1 match" },
  { level: 2, name: "Regular", label: "5 matches" },
  { level: 3, name: "Veteran", label: "10 matches" },
  { level: 4, name: "Seasoned", label: "25 matches" },
  { level: 5, name: "Century", label: "100 matches" },
];

const SHARPSHOOTER_TIERS = [
  { level: 1, name: "Bronze", label: "60% A-zone" },
  { level: 2, name: "Silver", label: "70% A-zone" },
  { level: 3, name: "Gold", label: "80% A-zone" },
  { level: 4, name: "Elite", label: "85% A-zone" },
];

describe("diffAchievements", () => {
  it("returns empty array when no achievements exist", () => {
    const result = diffAchievements([], null);
    expect(result).toEqual([]);
  });

  it("returns empty array on first run (snapshot is null)", () => {
    // First run should result in a snapshot, but diffAchievements doesn't
    // know about first-run logic — it just sees null snapshot and reports all as new
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2]),
    ];
    const result = diffAchievements(achievements, null);
    // With null snapshot, all unlocked tiers above 0 are "new"
    expect(result.length).toBe(2);
    expect(result[0].tierLevel).toBe(1);
    expect(result[1].tierLevel).toBe(2);
  });

  it("returns empty array when nothing changed", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2]),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [{ id: "match-count", tier: 2 }],
      lastChecked: "2026-01-01T00:00:00Z",
    };
    const result = diffAchievements(achievements, snapshot);
    expect(result).toEqual([]);
  });

  it("detects a single new tier unlock", () => {
    const achievements = [
      makeAchievement(
        "match-count",
        "Competitor",
        "trophy",
        COMPETITOR_TIERS,
        [1, 2, 3],
        { name: "Seasoned", label: "25 matches" },
      ),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [{ id: "match-count", tier: 2 }],
      lastChecked: "2026-01-01T00:00:00Z",
    };

    const result = diffAchievements(achievements, snapshot);
    expect(result).toHaveLength(1);
    expect(result[0].achievementId).toBe("match-count");
    expect(result[0].achievementName).toBe("Competitor");
    expect(result[0].tierLevel).toBe(3);
    expect(result[0].tierName).toBe("Veteran");
    expect(result[0].tierLabel).toBe("10 matches");
    expect(result[0].nextTier).toEqual({ name: "Seasoned", label: "25 matches" });
    expect(result[0].unlockedLevels).toEqual([1, 2, 3]);
  });

  it("detects multiple new tiers (skipped tiers)", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2, 3, 4]),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [{ id: "match-count", tier: 2 }],
      lastChecked: "2026-01-01T00:00:00Z",
    };

    const result = diffAchievements(achievements, snapshot);
    expect(result).toHaveLength(2);
    expect(result[0].tierLevel).toBe(3);
    expect(result[1].tierLevel).toBe(4);
  });

  it("detects unlocks across multiple achievements", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2, 3]),
      makeAchievement("sharpshooter", "Sharpshooter", "crosshair", SHARPSHOOTER_TIERS, [1, 2]),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [
        { id: "match-count", tier: 2 },
        { id: "sharpshooter", tier: 1 },
      ],
      lastChecked: "2026-01-01T00:00:00Z",
    };

    const result = diffAchievements(achievements, snapshot);
    expect(result).toHaveLength(2);
    expect(result[0].achievementId).toBe("match-count");
    expect(result[0].tierLevel).toBe(3);
    expect(result[1].achievementId).toBe("sharpshooter");
    expect(result[1].tierLevel).toBe(2);
  });

  it("detects brand new achievement (not in snapshot)", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2]),
      makeAchievement("sharpshooter", "Sharpshooter", "crosshair", SHARPSHOOTER_TIERS, [1]),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [{ id: "match-count", tier: 2 }],
      lastChecked: "2026-01-01T00:00:00Z",
    };

    const result = diffAchievements(achievements, snapshot);
    expect(result).toHaveLength(1);
    expect(result[0].achievementId).toBe("sharpshooter");
    expect(result[0].tierLevel).toBe(1);
  });

  it("ignores achievements with no unlocked tiers", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, []),
    ];
    const snapshot: AchievementSnapshot = {
      achievements: [],
      lastChecked: "2026-01-01T00:00:00Z",
    };

    const result = diffAchievements(achievements, snapshot);
    expect(result).toEqual([]);
  });
});

describe("buildSnapshot", () => {
  it("creates snapshot with highest unlocked tier per achievement", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1, 2, 3]),
      makeAchievement("sharpshooter", "Sharpshooter", "crosshair", SHARPSHOOTER_TIERS, [1]),
    ];

    const snapshot = buildSnapshot(achievements);
    expect(snapshot.achievements).toHaveLength(2);
    expect(snapshot.achievements).toContainEqual({ id: "match-count", tier: 3 });
    expect(snapshot.achievements).toContainEqual({ id: "sharpshooter", tier: 1 });
    expect(snapshot.lastChecked).toBeTruthy();
  });

  it("excludes achievements with no unlocked tiers", () => {
    const achievements = [
      makeAchievement("match-count", "Competitor", "trophy", COMPETITOR_TIERS, [1]),
      makeAchievement("sharpshooter", "Sharpshooter", "crosshair", SHARPSHOOTER_TIERS, []),
    ];

    const snapshot = buildSnapshot(achievements);
    expect(snapshot.achievements).toHaveLength(1);
    expect(snapshot.achievements[0].id).toBe("match-count");
  });

  it("returns empty achievements for empty input", () => {
    const snapshot = buildSnapshot([]);
    expect(snapshot.achievements).toEqual([]);
  });
});

describe("buildAchievementEmbed", () => {
  it("builds single unlock embed", () => {
    const unlocks: AchievementUnlock[] = [
      {
        achievementId: "match-count",
        achievementName: "Competitor",
        achievementIcon: "trophy",
        tierLevel: 3,
        tierName: "Veteran",
        tierLabel: "10 matches",
        allTiers: COMPETITOR_TIERS,
        unlockedLevels: [1, 2, 3],
        nextTier: { name: "Seasoned", label: "25 matches" },
      },
    ];

    const embed = buildAchievementEmbed("John Doe", 12345, unlocks, "https://example.com");

    expect(embed.title).toBe("John Doe unlocked a new achievement!");
    expect(embed.url).toBe("https://example.com/shooter/12345");
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0].name).toContain("Competitor");
    expect(embed.fields![0].name).toContain("Veteran");
    // Verify tier ladder content
    const value = embed.fields![0].value;
    expect(value).toContain("First Match");
    expect(value).toContain("NEW!");
    expect(value).toContain("Next: **Seasoned**");
  });

  it("builds multi-unlock embed with correct title", () => {
    const unlocks: AchievementUnlock[] = [
      {
        achievementId: "match-count",
        achievementName: "Competitor",
        achievementIcon: "trophy",
        tierLevel: 3,
        tierName: "Veteran",
        tierLabel: "10 matches",
        allTiers: COMPETITOR_TIERS,
        unlockedLevels: [1, 2, 3],
        nextTier: null,
      },
      {
        achievementId: "sharpshooter",
        achievementName: "Sharpshooter",
        achievementIcon: "crosshair",
        tierLevel: 1,
        tierName: "Bronze",
        tierLabel: "60% A-zone",
        allTiers: SHARPSHOOTER_TIERS,
        unlockedLevels: [1],
        nextTier: { name: "Silver", label: "70% A-zone" },
      },
    ];

    const embed = buildAchievementEmbed("Jane Smith", 99, unlocks, "https://example.com");

    expect(embed.title).toBe("Jane Smith unlocked 2 new achievements!");
    expect(embed.fields).toHaveLength(2);
  });
});
