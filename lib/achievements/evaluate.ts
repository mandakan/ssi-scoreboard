// Pure achievement evaluation engine — no I/O, fully unit-testable.

import { ACHIEVEMENT_ENTRIES } from "./definitions";
import type {
  AchievementEvalContext,
  AchievementProgress,
  StoredAchievement,
  UnlockedTier,
} from "./types";

/**
 * Evaluate all achievements against the given context and stored state.
 * Returns full progress for display and any newly unlocked tiers to persist.
 */
export function evaluateAchievements(
  ctx: AchievementEvalContext,
  stored: StoredAchievement[],
): {
  achievements: AchievementProgress[];
  newUnlocks: StoredAchievement[];
} {
  const storedByKey = new Map<string, StoredAchievement>();
  for (const s of stored) {
    storedByKey.set(`${s.achievementId}:${s.tier}`, s);
  }

  const now = new Date().toISOString();
  const achievements: AchievementProgress[] = [];
  const newUnlocks: StoredAchievement[] = [];

  for (const entry of ACHIEVEMENT_ENTRIES) {
    const { definition, evaluate } = entry;
    const currentValue = evaluate(ctx);

    // Determine which tiers are unlocked
    const unlockedTiers: UnlockedTier[] = [];
    for (const tier of definition.tiers) {
      if (currentValue >= tier.threshold) {
        const key = `${definition.id}:${tier.level}`;
        const existing = storedByKey.get(key);

        if (existing) {
          unlockedTiers.push({
            level: tier.level,
            unlockedAt: existing.unlockedAt,
            matchRef: existing.matchRef,
            value: existing.value,
          });
        } else {
          // Newly unlocked
          const unlock: StoredAchievement = {
            achievementId: definition.id,
            tier: tier.level,
            unlockedAt: now,
            matchRef: null,
            value: currentValue,
          };
          newUnlocks.push(unlock);
          unlockedTiers.push({
            level: tier.level,
            unlockedAt: now,
            matchRef: null,
            value: currentValue,
          });
        }
      }
    }

    // Find next tier
    const nextTier =
      definition.tiers.find((t) => currentValue < t.threshold) ?? null;

    // Compute progress toward next tier
    let progressToNext = 1;
    if (nextTier) {
      const prevThreshold =
        unlockedTiers.length > 0
          ? definition.tiers[unlockedTiers.length - 1].threshold
          : 0;
      const range = nextTier.threshold - prevThreshold;
      progressToNext =
        range > 0 ? Math.min(1, (currentValue - prevThreshold) / range) : 0;
    }

    achievements.push({
      definition,
      currentValue,
      unlockedTiers,
      nextTier,
      progressToNext,
    });
  }

  return { achievements, newUnlocks };
}
