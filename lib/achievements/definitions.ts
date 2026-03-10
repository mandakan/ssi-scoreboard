// Achievement definitions and evaluators.

import type { AchievementDefinition, AchievementEvalContext } from "./types";
import type { ShooterMatchSummary } from "@/lib/types";

export type Evaluator = (ctx: AchievementEvalContext) => number;

export interface AchievementEntry {
  definition: AchievementDefinition;
  evaluate: Evaluator;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const L2_PLUS = new Set([
  "l2", "l3", "l4", "l5",                        // raw Django choice codes
  "Level II", "Level III", "Level IV", "Level V", // display names (legacy)
]);
const L4_PLUS = new Set([
  "l4", "l5",                  // raw codes
  "Level IV", "Level V",       // display names (legacy)
]);

function isL2Plus(m: ShooterMatchSummary): boolean {
  return m.level != null && L2_PLUS.has(m.level);
}

function isL4Plus(m: ShooterMatchSummary): boolean {
  return m.level != null && L4_PLUS.has(m.level);
}

// ── Milestone ────────────────────────────────────────────────────────────────

const matchCount: AchievementEntry = {
  definition: {
    id: "match-count",
    name: "Competitor",
    description: "Compete in Level II+ matches tracked on this app.",
    category: "milestone",
    icon: "trophy",
    tiers: [
      { level: 1, name: "First Match", threshold: 1, label: "1 match" },
      { level: 2, name: "Regular", threshold: 5, label: "5 matches" },
      { level: 3, name: "Veteran", threshold: 10, label: "10 matches" },
      { level: 4, name: "Dedicated", threshold: 25, label: "25 matches" },
      { level: 5, name: "Elite", threshold: 50, label: "50 matches" },
      { level: 6, name: "Legend", threshold: 100, label: "100 matches" },
    ],
  },
  evaluate: (ctx) => ctx.matches.filter(isL2Plus).length,
};

const stageCount: AchievementEntry = {
  definition: {
    id: "stage-count",
    name: "Stage Warrior",
    description: "Complete stages across Level II+ matches.",
    category: "milestone",
    icon: "swords",
    tiers: [
      { level: 1, name: "Rookie", threshold: 10, label: "10 stages" },
      { level: 2, name: "Regular", threshold: 50, label: "50 stages" },
      { level: 3, name: "Seasoned", threshold: 100, label: "100 stages" },
      { level: 4, name: "Warrior", threshold: 250, label: "250 stages" },
      { level: 5, name: "Champion", threshold: 500, label: "500 stages" },
    ],
  },
  evaluate: (ctx) =>
    ctx.matches.filter(isL2Plus).reduce((sum, m) => sum + m.stageCount, 0),
};

const championship: AchievementEntry = {
  definition: {
    id: "championship",
    name: "Championship",
    description: "Compete in Level IV+ continental or world championships.",
    category: "milestone",
    icon: "award",
    tiers: [
      {
        level: 1,
        name: "Continental Debut",
        threshold: 1,
        label: "1 championship",
      },
      {
        level: 2,
        name: "Championship Regular",
        threshold: 3,
        label: "3 championships",
      },
      {
        level: 3,
        name: "Championship Veteran",
        threshold: 5,
        label: "5 championships",
      },
    ],
  },
  evaluate: (ctx) => ctx.matches.filter(isL4Plus).length,
};

const worldShoot: AchievementEntry = {
  definition: {
    id: "world-shoot",
    name: "World Shoot",
    description: "Compete in the IPSC World Shoot.",
    category: "milestone",
    icon: "globe",
    tiers: [
      { level: 1, name: "World Shooter", threshold: 1, label: "1 World Shoot" },
    ],
  },
  evaluate: (ctx) =>
    ctx.matches.filter((m) => m.level === "l5" || m.level === "Level V").length,
};

const dqClub: AchievementEntry = {
  definition: {
    id: "dq-club",
    name: "DQ Club",
    description: "Been there, done that.",
    category: "milestone",
    icon: "ban",
    tiers: [
      { level: 1, name: "Been there, done that", threshold: 1, label: "1 DQ" },
    ],
  },
  evaluate: (ctx) => ctx.matches.filter((m) => m.dq).length,
};

// ── Accuracy ─────────────────────────────────────────────────────────────────

const sharpshooter: AchievementEntry = {
  definition: {
    id: "sharpshooter",
    name: "Sharpshooter",
    description: "Achieve a high A-zone hit percentage across all matches.",
    category: "accuracy",
    icon: "crosshair",
    tiers: [
      { level: 1, name: "Marksman", threshold: 60, label: "60% A-zone" },
      { level: 2, name: "Sharpshooter", threshold: 70, label: "70% A-zone" },
      { level: 3, name: "Expert", threshold: 80, label: "80% A-zone" },
      { level: 4, name: "Master", threshold: 85, label: "85% A-zone" },
    ],
  },
  evaluate: (ctx) => ctx.stats.aPercent ?? 0,
};

const perfectStages: AchievementEntry = {
  definition: {
    id: "perfect-stages",
    name: "Bullseye",
    description:
      "Shoot stages with all A-zone hits and zero penalties (no C/D hits, misses, no-shoots, or procedurals).",
    category: "accuracy",
    icon: "target",
    tiers: [
      { level: 1, name: "First Perfect", threshold: 1, label: "1 perfect stage" },
      { level: 2, name: "Sharp Eye", threshold: 5, label: "5 perfect stages" },
      { level: 3, name: "Precision", threshold: 10, label: "10 perfect stages" },
      { level: 4, name: "Flawless", threshold: 25, label: "25 perfect stages" },
    ],
  },
  evaluate: (ctx) =>
    ctx.matches.reduce((sum, m) => sum + (m.perfectStages ?? 0), 0),
};

const cleanMatch: AchievementEntry = {
  definition: {
    id: "clean-match",
    name: "Clean Sheet",
    description: "Complete matches with zero misses, no-shoots, and procedurals.",
    category: "accuracy",
    icon: "shield-check",
    tiers: [
      { level: 1, name: "First Clean", threshold: 1, label: "1 clean match" },
      { level: 2, name: "Disciplined", threshold: 3, label: "3 clean matches" },
      { level: 3, name: "Composed", threshold: 5, label: "5 clean matches" },
      { level: 4, name: "Untouchable", threshold: 10, label: "10 clean matches" },
    ],
  },
  evaluate: (ctx) =>
    ctx.matches.filter(
      (m) =>
        m.stageCount > 0 &&
        m.totalMiss === 0 &&
        m.totalNoShoots === 0 &&
        (m.totalProcedurals ?? 0) === 0,
    ).length,
};

// ── Variety ──────────────────────────────────────────────────────────────────

const globeTrotter: AchievementEntry = {
  definition: {
    id: "globe-trotter",
    name: "Globe Trotter",
    description: "Compete in matches across different countries.",
    category: "variety",
    icon: "map-pin",
    tiers: [
      { level: 1, name: "Explorer", threshold: 2, label: "2 countries" },
      { level: 2, name: "Traveler", threshold: 3, label: "3 countries" },
      { level: 3, name: "Globe Trotter", threshold: 5, label: "5 countries" },
    ],
  },
  evaluate: (ctx) => {
    const regions = new Set<string>();
    for (const m of ctx.matches) {
      if (m.region) regions.add(m.region);
    }
    return regions.size;
  },
};

const versatile: AchievementEntry = {
  definition: {
    id: "versatile",
    name: "Versatile",
    description: "Compete in multiple different divisions.",
    category: "variety",
    icon: "shuffle",
    tiers: [
      { level: 1, name: "Dual Wielder", threshold: 2, label: "2 divisions" },
      {
        level: 2,
        name: "Multi-Divisional",
        threshold: 3,
        label: "3 divisions",
      },
      {
        level: 3,
        name: "Jack of All Trades",
        threshold: 5,
        label: "5 divisions",
      },
    ],
  },
  evaluate: (ctx) => {
    const divisions = new Set<string>();
    for (const m of ctx.matches) {
      if (m.division) divisions.add(m.division);
    }
    return divisions.size;
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const ACHIEVEMENT_ENTRIES: AchievementEntry[] = [
  matchCount,
  stageCount,
  championship,
  worldShoot,
  sharpshooter,
  perfectStages,
  cleanMatch,
  dqClub,
  globeTrotter,
  versatile,
];

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] =
  ACHIEVEMENT_ENTRIES.map((e) => e.definition);
