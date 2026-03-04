// Achievement system types.

import type { LucideIcon } from "lucide-react";
import type { ShooterMatchSummary, ShooterAggregateStats } from "@/lib/types";

export interface AchievementTier {
  level: number;
  name: string;
  threshold: number;
  label: string;
}

export type AchievementCategory =
  | "milestone"
  | "accuracy"
  | "performance"
  | "consistency"
  | "variety";

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: LucideIcon;
  tiers: AchievementTier[];
}

export interface AchievementEvalContext {
  matchCount: number;
  matches: ShooterMatchSummary[];
  stats: ShooterAggregateStats;
}

export interface AchievementProgress {
  definition: AchievementDefinition;
  currentValue: number;
  unlockedTiers: UnlockedTier[];
  nextTier: AchievementTier | null;
  progressToNext: number;
}

export interface UnlockedTier {
  level: number;
  unlockedAt: string;
  matchRef: string | null;
  value: number | null;
}

export interface StoredAchievement {
  achievementId: string;
  tier: number;
  unlockedAt: string;
  matchRef: string | null;
  value: number | null;
}
