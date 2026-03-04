// Achievement definitions and evaluators.

import type { AchievementDefinition, AchievementEvalContext } from "./types";

export type Evaluator = (ctx: AchievementEvalContext) => number;

export interface AchievementEntry {
  definition: AchievementDefinition;
  evaluate: Evaluator;
}

const matchCount: AchievementEntry = {
  definition: {
    id: "match-count",
    name: "Competitor",
    description: "Compete in matches tracked on this app.",
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
  evaluate: (ctx) => ctx.matchCount,
};

const stageCount: AchievementEntry = {
  definition: {
    id: "stage-count",
    name: "Stage Warrior",
    description: "Complete stages across all matches.",
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
  evaluate: (ctx) => ctx.stats.totalStages,
};

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
    description: "Shoot stages with all A-zone hits and zero penalties (no C/D hits, misses, no-shoots, or procedurals).",
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

export const ACHIEVEMENT_ENTRIES: AchievementEntry[] = [
  matchCount,
  stageCount,
  sharpshooter,
  perfectStages,
  cleanMatch,
  dqClub,
];

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] =
  ACHIEVEMENT_ENTRIES.map((e) => e.definition);
