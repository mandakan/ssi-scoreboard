// Pure function for near-achievement nudges. No I/O, fully unit-tested.

import type { AchievementProgress } from "./types";

export interface NearAchievement {
  /** Full progress object — used by the UI to render the tier popover. */
  progress: AchievementProgress;
  remaining: number;
  /** Human-readable nudge: "{N} more {unit}" e.g. "3 more matches" */
  nudge: string;
}

const MAX_NEAR = 3;

/**
 * At least 25% of the way through the step toward the next tier is
 * the threshold for "near". Anything below is not actionable today.
 */
const MIN_PROGRESS_TO_NEXT = 0.25;

/**
 * Extract the unit word(s) from a tier label like "5 matches" → "matches".
 * Labels follow the format "{threshold} {unit}", e.g. "25 matches",
 * "3 divisions", "100 stages".
 */
function unitFromLabel(label: string): string {
  return label.replace(/^\d+\s*/, "").trim();
}

/**
 * Return up to MAX_NEAR near-achievement nudges sorted by closest first
 * (highest progressToNext = smallest remaining proportion).
 *
 * Excludes: already-maxed achievements (nextTier === null) and achievements
 * where the shooter has covered less than MIN_PROGRESS_TO_NEXT of the
 * current step toward the next tier.
 */
export function computeNearAchievements(
  achievements: AchievementProgress[],
): NearAchievement[] {
  const candidates: NearAchievement[] = [];

  for (const a of achievements) {
    if (!a.nextTier) continue;
    if (a.progressToNext < MIN_PROGRESS_TO_NEXT) continue;

    const remaining = a.nextTier.threshold - a.currentValue;
    const unit = unitFromLabel(a.nextTier.label);

    candidates.push({
      progress: a,
      remaining,
      nudge: `${remaining} more ${unit}`,
    });
  }

  candidates.sort((a, b) => b.progress.progressToNext - a.progress.progressToNext);
  return candidates.slice(0, MAX_NEAR);
}
