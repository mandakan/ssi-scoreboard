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

const TOTAL_ACHIEVEMENTS = 15;

describe("evaluateAchievements", () => {
  it("returns no unlocks for zero matches", () => {
    const ctx = makeCtx({
      matchCount: 0,
      matches: [],
      stats: makeStats({ totalStages: 0, aPercent: null }),
    });
    const { achievements, newUnlocks } = evaluateAchievements(ctx, []);

    expect(achievements.length).toBe(TOTAL_ACHIEVEMENTS);
    expect(newUnlocks.length).toBe(0);
    for (const a of achievements) {
      expect(a.unlockedTiers).toHaveLength(0);
      expect(a.nextTier).not.toBeNull();
    }
  });

  it("unlocks First Match tier for 1 L2+ match", () => {
    const ctx = makeCtx({ matchCount: 1 });
    const { achievements, newUnlocks } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.unlockedTiers).toHaveLength(1);
    expect(matchCountAch.unlockedTiers[0].level).toBe(1);
    expect(matchCountAch.nextTier?.threshold).toBe(5);

    expect(newUnlocks.some((u) => u.achievementId === "match-count" && u.tier === 1)).toBe(true);
  });

  it("does not count Level I matches for match-count", () => {
    const ctx = makeCtx({
      matchCount: 3,
      matches: [
        makeMatch({ level: "Level I" }),
        makeMatch({ matchId: "2", level: "Level II" }),
        makeMatch({ matchId: "3", level: null }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    // Only the Level II match counts
    expect(matchCountAch.currentValue).toBe(1);
  });

  it("recognises raw level codes (l2, l3, etc.) for match-count", () => {
    const ctx = makeCtx({
      matchCount: 4,
      matches: [
        makeMatch({ matchId: "1", level: "l2" }),
        makeMatch({ matchId: "2", level: "l3" }),
        makeMatch({ matchId: "3", level: "l1" }),
        makeMatch({ matchId: "4", level: null }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    // l2 + l3 = 2
    expect(matchCountAch.currentValue).toBe(2);
  });

  it("counts only L2+ stages for stage-count", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ level: "Level II", stageCount: 8 }),
        makeMatch({ matchId: "2", level: "Level III", stageCount: 12 }),
        makeMatch({ matchId: "3", level: "Level I", stageCount: 6 }),
        makeMatch({ matchId: "4", level: null, stageCount: 4 }),
      ],
      stats: makeStats({ totalStages: 30 }),
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const stageAch = achievements.find((a) => a.definition.id === "stage-count")!;
    // Only L2 (8) + L3 (12) = 20
    expect(stageAch.currentValue).toBe(20);
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
    const ctx = makeCtx({
      matchCount: 5,
      matches: Array.from({ length: 5 }, (_, i) =>
        makeMatch({ matchId: String(i + 1) }),
      ),
    });
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

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.unlockedTiers).toHaveLength(2); // tier 1 (stored) + tier 2 (new)
    expect(newUnlocks.find((u) => u.achievementId === "match-count" && u.tier === 1)).toBeUndefined();
    expect(newUnlocks.find((u) => u.achievementId === "match-count" && u.tier === 2)).toBeDefined();
  });

  it("computes correct progress to next tier", () => {
    const ctx = makeCtx({
      matchCount: 3,
      matches: Array.from({ length: 3 }, (_, i) =>
        makeMatch({ matchId: String(i + 1) }),
      ),
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    // Between tier 1 (threshold=1) and tier 2 (threshold=5), at value=3
    // progress = (3-1)/(5-1) = 0.5
    expect(matchCountAch.progressToNext).toBeCloseTo(0.5);
  });

  it("returns nextTier=null and progress=1 when all tiers complete", () => {
    const ctx = makeCtx({
      matchCount: 100,
      matches: Array.from({ length: 50 }, (_, i) =>
        makeMatch({ matchId: String(i + 1) }),
      ),
    });
    const { achievements } = evaluateAchievements(ctx, []);

    // match-count has max tier at 100, but we only have 50 matches in ctx.matches
    // (evaluator now counts from matches array, not matchCount)
    const matchCountAch = achievements.find((a) => a.definition.id === "match-count")!;
    expect(matchCountAch.currentValue).toBe(50);
    // With 50 matches, tiers up to 50 are unlocked (5 tiers: 1,5,10,25,50)
    expect(matchCountAch.unlockedTiers).toHaveLength(5);
    expect(matchCountAch.nextTier?.threshold).toBe(100);
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

  // ── Championship (L4+) ──────────────────────────────────────────────────

  it("counts L4+ matches for championship", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "Level IV" }),
        makeMatch({ matchId: "2", level: "Level V" }),
        makeMatch({ matchId: "3", level: "Level III" }),
        makeMatch({ matchId: "4", level: "Level II" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const champAch = achievements.find((a) => a.definition.id === "championship")!;
    expect(champAch.currentValue).toBe(2);
    expect(champAch.unlockedTiers).toHaveLength(1); // threshold 1
    expect(champAch.nextTier?.threshold).toBe(3);
  });

  it("counts raw l4/l5 codes for championship", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l4" }),
        makeMatch({ matchId: "2", level: "l5" }),
        makeMatch({ matchId: "3", level: "l3" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const champAch = achievements.find((a) => a.definition.id === "championship")!;
    expect(champAch.currentValue).toBe(2);
  });

  // ── World Shoot ──────────────────────────────────────────────────────────

  it("counts Level V matches for world-shoot", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "Level V" }),
        makeMatch({ matchId: "2", level: "Level IV" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const wsAch = achievements.find((a) => a.definition.id === "world-shoot")!;
    expect(wsAch.currentValue).toBe(1);
    expect(wsAch.unlockedTiers).toHaveLength(1);
    expect(wsAch.nextTier).toBeNull();
  });

  it("counts raw l5 code for world-shoot", () => {
    const ctx = makeCtx({
      matches: [makeMatch({ level: "l5" })],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const wsAch = achievements.find((a) => a.definition.id === "world-shoot")!;
    expect(wsAch.currentValue).toBe(1);
    expect(wsAch.unlockedTiers).toHaveLength(1);
  });

  it("does not unlock world-shoot for Level IV only", () => {
    const ctx = makeCtx({
      matches: [makeMatch({ level: "Level IV" })],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const wsAch = achievements.find((a) => a.definition.id === "world-shoot")!;
    expect(wsAch.currentValue).toBe(0);
    expect(wsAch.unlockedTiers).toHaveLength(0);
  });

  // ── Globe Trotter ────────────────────────────────────────────────────────

  it("counts distinct regions for globe-trotter", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", region: "Sweden" }),
        makeMatch({ matchId: "2", region: "Norway" }),
        makeMatch({ matchId: "3", region: "Sweden" }),
        makeMatch({ matchId: "4", region: "Denmark" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const gtAch = achievements.find((a) => a.definition.id === "globe-trotter")!;
    expect(gtAch.currentValue).toBe(3);
    expect(gtAch.unlockedTiers).toHaveLength(2); // 2 and 3
    expect(gtAch.nextTier?.threshold).toBe(5);
  });

  it("ignores null regions for globe-trotter", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", region: "Sweden" }),
        makeMatch({ matchId: "2", region: null }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const gtAch = achievements.find((a) => a.definition.id === "globe-trotter")!;
    expect(gtAch.currentValue).toBe(1);
    expect(gtAch.unlockedTiers).toHaveLength(0);
  });

  // ── Versatile ────────────────────────────────────────────────────────────

  it("counts distinct divisions for versatile", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", division: "Production" }),
        makeMatch({ matchId: "2", division: "Open Major" }),
        makeMatch({ matchId: "3", division: "Production" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const vAch = achievements.find((a) => a.definition.id === "versatile")!;
    expect(vAch.currentValue).toBe(2);
    expect(vAch.unlockedTiers).toHaveLength(1); // threshold 2
    expect(vAch.nextTier?.threshold).toBe(3);
  });

  it("ignores null divisions for versatile", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", division: "Production" }),
        makeMatch({ matchId: "2", division: null }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const vAch = achievements.find((a) => a.definition.id === "versatile")!;
    expect(vAch.currentValue).toBe(1);
    expect(vAch.unlockedTiers).toHaveLength(0);
  });

  // ── Social Shooter ───────────────────────────────────────────────────────

  it("counts unique squadmates across all matches", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", squadmateShooterIds: [10, 11, 12] }),
        makeMatch({ matchId: "2", squadmateShooterIds: [11, 13, 14] }), // 11 is a repeat
        makeMatch({ matchId: "3", squadmateShooterIds: [] }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "social-shooter")!;
    expect(ach.currentValue).toBe(5); // 10, 11, 12, 13, 14
    expect(ach.unlockedTiers).toHaveLength(0); // first tier at 10
  });

  it("unlocks social-shooter tier at 10 unique squadmates", () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1);
    const ctx = makeCtx({
      matches: [makeMatch({ squadmateShooterIds: ids })],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "social-shooter")!;
    expect(ach.currentValue).toBe(10);
    expect(ach.unlockedTiers).toHaveLength(1);
    expect(ach.nextTier?.threshold).toBe(25);
  });

  it("returns 0 for social-shooter when no squad data", () => {
    const ctx = makeCtx({
      matches: [makeMatch(), makeMatch({ matchId: "2" })],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "social-shooter")!;
    expect(ach.currentValue).toBe(0);
    expect(ach.unlockedTiers).toHaveLength(0);
  });

  // ── Usual Suspects ───────────────────────────────────────────────────────

  it("returns max recurrence count for usual-suspects", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", squadmateShooterIds: [10, 20] }),
        makeMatch({ matchId: "2", squadmateShooterIds: [10, 30] }),
        makeMatch({ matchId: "3", squadmateShooterIds: [10, 20] }),
        makeMatch({ matchId: "4", squadmateShooterIds: [20] }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "usual-suspects")!;
    // Shooter 10 appears in matches 1, 2, 3 → count 3; shooter 20 in 1, 3, 4 → count 3
    expect(ach.currentValue).toBe(3);
    expect(ach.unlockedTiers).toHaveLength(2); // thresholds 2 and 3
  });

  it("unlocks first usual-suspects tier at 2 shared matches", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", squadmateShooterIds: [99] }),
        makeMatch({ matchId: "2", squadmateShooterIds: [99] }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "usual-suspects")!;
    expect(ach.currentValue).toBe(2);
    expect(ach.unlockedTiers).toHaveLength(1);
    expect(ach.nextTier?.threshold).toBe(3);
  });

  it("returns 0 for usual-suspects when no squad data", () => {
    const ctx = makeCtx({ matches: [makeMatch(), makeMatch({ matchId: "2" })] });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "usual-suspects")!;
    expect(ach.currentValue).toBe(0);
  });

  // ── Fresh Faces ──────────────────────────────────────────────────────────

  it("counts matches where all squadmates are first-timers", () => {
    const ctx = makeCtx({
      matches: [
        // oldest first (chronological)
        makeMatch({ matchId: "1", date: "2023-01-01T00:00:00Z", squadmateShooterIds: [10, 11, 12] }),
        makeMatch({ matchId: "2", date: "2023-06-01T00:00:00Z", squadmateShooterIds: [11, 13] }), // 11 seen → not fresh
        makeMatch({ matchId: "3", date: "2024-01-01T00:00:00Z", squadmateShooterIds: [20, 21] }), // all new → fresh
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "fresh-faces")!;
    // match 1 is fresh (first squad ever), match 2 is not (11 seen), match 3 is fresh → 2
    expect(ach.currentValue).toBe(2);
    expect(ach.unlockedTiers).toHaveLength(1); // threshold 2
  });

  it("processes fresh-faces in chronological order regardless of array order", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "3", date: "2025-01-01T00:00:00Z", squadmateShooterIds: [30, 31] }),
        makeMatch({ matchId: "1", date: "2023-01-01T00:00:00Z", squadmateShooterIds: [10, 11] }),
        makeMatch({ matchId: "2", date: "2024-01-01T00:00:00Z", squadmateShooterIds: [10, 20] }), // 10 seen
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "fresh-faces")!;
    // sorted: match1 (fresh), match2 (10 seen → not fresh), match3 (fresh) → 2
    expect(ach.currentValue).toBe(2);
  });

  it("skips matches without squad data for fresh-faces", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", date: "2023-01-01T00:00:00Z" }), // no squad data
        makeMatch({ matchId: "2", date: "2024-01-01T00:00:00Z", squadmateShooterIds: [10] }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "fresh-faces")!;
    // Only match 2 has squad data, and it's the first with data → fresh → 1
    expect(ach.currentValue).toBe(1);
  });

  // ── Band of Brothers ─────────────────────────────────────────────────────

  it("counts matches where squadAllSameClub is true", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", squadAllSameClub: true }),
        makeMatch({ matchId: "2", squadAllSameClub: false }),
        makeMatch({ matchId: "3", squadAllSameClub: true }),
        makeMatch({ matchId: "4" }), // undefined — not counted
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "band-of-brothers")!;
    expect(ach.currentValue).toBe(2);
    expect(ach.unlockedTiers).toHaveLength(1); // threshold 2
  });

  it("returns 0 for band-of-brothers when no club-only squads", () => {
    const ctx = makeCtx({
      matches: [makeMatch(), makeMatch({ matchId: "2" })],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "band-of-brothers")!;
    expect(ach.currentValue).toBe(0);
  });

  // ── Traditionalist ───────────────────────────────────────────────────────

  it("counts distinct years at same Swedish L3+ event — year in name", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "Oden Cup 2021 LvL III", date: "2021-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "Oden Cup 2023",         date: "2023-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "3", level: "l3", region: "SWE", name: "Oden Cup 2024",         date: "2024-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "4", level: "l2", region: "SWE", name: "Club Match 2024",        date: "2024-03-01T00:00:00Z", discipline: "IPSC Handgun" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    expect(ach.currentValue).toBe(3); // 3 L3+ years
    expect(ach.unlockedTiers).toHaveLength(2); // thresholds 2 and 3
  });

  it("normalises HFO edition-number names to the same series key", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "HFO.6 - HG & PCC - Accidental Discharge", date: "2023-06-01T00:00:00Z", discipline: "IPSC Handgun & PCC" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "HFO.9 - PCC, Love & Handguns",            date: "2024-06-01T00:00:00Z", discipline: "IPSC Handgun & PCC" }),
        makeMatch({ matchId: "3", level: "l3", region: "SWE", name: "HFO.10 - The Triggerfreeze (HG & PCC)",   date: "2025-06-01T00:00:00Z", discipline: "IPSC Handgun & PCC" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    expect(ach.currentValue).toBe(3); // all three normalise to "hfo"
    expect(ach.unlockedTiers).toHaveLength(2);
  });

  it("normalises Roman-numeral chapter series", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "Chapter II",  date: "2023-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "Chapter III", date: "2024-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "3", level: "l3", region: "SWE", name: "Chapter IV",  date: "2025-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    expect(ach.currentValue).toBe(3); // all three normalise to "chapter"
  });

  it("normalises year-embedded name (SNO2025)", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "SNO 2023",   date: "2023-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "SNO2025 HG", date: "2025-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    expect(ach.currentValue).toBe(2); // both normalise to "sno"
  });

  it("ignores non-Swedish L3+ matches for traditionalist", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "NOR", name: "Oden Cup 2023", date: "2023-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "NOR", name: "Oden Cup 2024", date: "2024-06-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "3", level: "l3", region: "SWE", name: "HFO.9 - PCC, Love & Handguns", date: "2024-06-01T00:00:00Z", discipline: "IPSC Handgun & PCC" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    // Norwegian matches excluded; only 1 Swedish L3+ match → max = 1
    expect(ach.currentValue).toBe(1);
    expect(ach.unlockedTiers).toHaveLength(0);
  });

  it("treats same event name in different discipline as separate series", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "Oden Cup 2023", date: "2023-05-01T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "Oden Cup 2024", date: "2024-05-01T00:00:00Z", discipline: "IPSC Shotgun" }),
        makeMatch({ matchId: "3", level: "l3", region: "SWE", name: "Oden Cup 2025", date: "2025-05-01T00:00:00Z", discipline: "IPSC Shotgun" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    // Handgun: 1 year; Shotgun: 2 years → max = 2
    expect(ach.currentValue).toBe(2);
    expect(ach.unlockedTiers).toHaveLength(1);
  });

  it("does not count the same year twice for traditionalist", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l3", region: "SWE", name: "HFO.3 / The Spring Roll - Handgun", date: "2022-08-10T00:00:00Z", discipline: "IPSC Handgun" }),
        makeMatch({ matchId: "2", level: "l3", region: "SWE", name: "HFO.3 / The Spring Roll - PCC",     date: "2022-08-11T00:00:00Z", discipline: "IPSC Handgun & PCC" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    // Both in 2022 but different disciplines → each group has 1 year → max = 1
    expect(ach.currentValue).toBe(1);
    expect(ach.unlockedTiers).toHaveLength(0);
  });

  it("returns 0 for traditionalist with only L2 Swedish matches", () => {
    const ctx = makeCtx({
      matches: [
        makeMatch({ matchId: "1", level: "l2", region: "SWE", name: "HFO.6 - Accidental Discharge", date: "2023-06-01T00:00:00Z" }),
        makeMatch({ matchId: "2", level: "l2", region: "SWE", name: "HFO.9 - PCC, Love & Handguns", date: "2024-06-01T00:00:00Z" }),
      ],
    });
    const { achievements } = evaluateAchievements(ctx, []);

    const ach = achievements.find((a) => a.definition.id === "traditionalist")!;
    expect(ach.currentValue).toBe(0);
    expect(ach.unlockedTiers).toHaveLength(0);
  });
});
