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
const L3_PLUS = new Set([
  "l3", "l4", "l5",
  "Level III", "Level IV", "Level V",
]);
const L4_PLUS = new Set([
  "l4", "l5",                  // raw codes
  "Level IV", "Level V",       // display names (legacy)
]);

function isL2Plus(m: ShooterMatchSummary): boolean {
  return m.level != null && L2_PLUS.has(m.level);
}

function isL3Plus(m: ShooterMatchSummary): boolean {
  return m.level != null && L3_PLUS.has(m.level);
}

function isL4Plus(m: ShooterMatchSummary): boolean {
  return m.level != null && L4_PLUS.has(m.level);
}

/**
 * Normalise a match name to a stable series key for grouping recurring events.
 *
 * Handles patterns observed in real SSI data:
 *   "HFO.10 - The Triggerfreeze (HG & PCC)"   → "hfo"
 *   "HFO.3 / The Spring Roll - Handgun"        → "hfo"
 *   "Oden Cup 2021 LvL III"                    → "oden cup"
 *   "SNO2025 HG"                               → "sno"
 *   "Chapter III"                              → "chapter"
 *   "Viking Match 2017 - Production Nationals" → "viking match"
 *   "Bergen Open - Revitalized 2024"           → "bergen open"
 *   "13th Helmbrechts-Cup 2023"                → "helmbrechts-cup"
 */
function normalizeMatchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[(\[（][^\)\]）]*[\)\]）]/g, "") // strip parenthesised/bracketed content
    .replace(/^\d+(?:st|nd|rd|th)\s+/, "")       // strip leading ordinal: "13th "
    .replace(/\s*\/.*$/, "")                      // strip subtitle after " / "
    .replace(/\s+-.*$/, "")                       // strip subtitle after " - " (space before dash)
    .replace(/\.\d+\s*$/, "")                     // strip edition number suffix: ".10"
    .replace(/\d{4}.*$/, "")                      // strip 4-digit year (with or without space) + everything after
    .replace(/\s+[ivxlcdm]+\s*$/i, "")            // strip trailing Roman numerals: "Chapter III"
    .trim()
    .replace(/\s+/g, " ");                        // collapse any double-spaces left behind
}

function extractYear(date: string | null): number | null {
  if (!date) return null;
  const m = /^(\d{4})/.exec(date);
  return m ? parseInt(m[1], 10) : null;
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

// ── Squad ─────────────────────────────────────────────────────────────────────

const socialShooter: AchievementEntry = {
  definition: {
    id: "social-shooter",
    name: "Social Shooter",
    description: "Share a squad with many different competitors across all your matches.",
    category: "variety",
    icon: "users",
    tiers: [
      { level: 1, name: "Friendly",     threshold: 10,  label: "10 unique squadmates" },
      { level: 2, name: "Networker",    threshold: 25,  label: "25 unique squadmates" },
      { level: 3, name: "Well-Known",   threshold: 50,  label: "50 unique squadmates" },
      { level: 4, name: "Community Pillar", threshold: 100, label: "100 unique squadmates" },
    ],
  },
  evaluate: (ctx) => {
    const seen = new Set<number>();
    for (const m of ctx.matches) {
      for (const id of (m.squadmateShooterIds ?? [])) {
        seen.add(id);
      }
    }
    return seen.size;
  },
};

const usualSuspects: AchievementEntry = {
  definition: {
    id: "usual-suspects",
    name: "Usual Suspects",
    description: "Keep ending up in the same squad as the same competitor across different matches.",
    category: "variety",
    icon: "user-check",
    tiers: [
      { level: 1, name: "Familiar Face",  threshold: 2, label: "2 matches with same squadmate" },
      { level: 2, name: "Squad Regular",  threshold: 3, label: "3 matches with same squadmate" },
      { level: 3, name: "Inseparable",    threshold: 5, label: "5 matches with same squadmate" },
    ],
  },
  evaluate: (ctx) => {
    const counts = new Map<number, number>();
    for (const m of ctx.matches) {
      for (const id of (m.squadmateShooterIds ?? [])) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    let max = 0;
    for (const count of counts.values()) {
      if (count > max) max = count;
    }
    return max;
  },
};

// ── Recurring competition ─────────────────────────────────────────────────────

const traditionalist: AchievementEntry = {
  definition: {
    id: "traditionalist",
    name: "Swedish Regular",
    description: "Return to the same Swedish Level III+ competition year after year.",
    category: "milestone",
    icon: "calendar",
    tiers: [
      { level: 1, name: "Returning",  threshold: 2, label: "2 years at same event" },
      { level: 2, name: "Dedicated",  threshold: 3, label: "3 years at same event" },
      { level: 3, name: "Legendary",  threshold: 5, label: "5 years at same event" },
    ],
  },
  evaluate: (ctx) => {
    // Group Swedish L3+ matches by (normalized name, discipline) and count distinct years.
    const groups = new Map<string, Set<number>>();
    for (const m of ctx.matches) {
      if (!isL3Plus(m)) continue;
      if (m.region !== "SWE") continue;
      const year = extractYear(m.date);
      if (!year) continue;
      const name = normalizeMatchName(m.name);
      if (!name) continue;
      const key = `${name}|||${m.discipline ?? ""}`;
      const existing = groups.get(key);
      if (existing) {
        existing.add(year);
      } else {
        groups.set(key, new Set([year]));
      }
    }
    let max = 0;
    for (const years of groups.values()) {
      if (years.size > max) max = years.size;
    }
    return max;
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
  socialShooter,
  usualSuspects,
  traditionalist,
];

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] =
  ACHIEVEMENT_ENTRIES.map((e) => e.definition);
