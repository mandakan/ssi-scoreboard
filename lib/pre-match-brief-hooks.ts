// Pure function for computing personalised pre-match brief hooks.
// No I/O, fully unit-tested.

import type { StageInfo, ShooterDashboardResponse, BriefHook } from "@/lib/types";
import type { SquadContext } from "@/lib/pre-match-prompt";

export const MAX_BRIEF_HOOKS = 5;

/**
 * Minimum match history required for trend-based hooks.
 * Below this the data is too noisy to emit actionable signals.
 */
const MIN_MATCHES = 5;

/** High penalty rate threshold: >= 5 penalties per 100 rounds. */
const HIGH_PENALTY_RATE = 0.05;

/** High CV (hit-factor coefficient of variation) threshold. */
const HIGH_CV = 0.2;

function countConstrainedStages(stages: StageInfo[]): number {
  return stages.filter((s) => {
    const proc = s.procedure ?? "";
    const fc = s.firearm_condition ?? "";
    return /unloaded|empty/i.test(fc) || /strong hand|weak hand/i.test(proc);
  }).length;
}

function countLongStages(stages: StageInfo[]): number {
  return stages.filter((s) => /long/i.test(s.course_display ?? "")).length;
}

/**
 * Compute personalised coaching hooks for the pre-match brief.
 *
 * Each hook is a one-sentence signal grounded in the shooter's career data
 * cross-referenced with this match's stage shape. The AI prompt receives
 * these as structured input to write personalised brief prose.
 *
 * Returns up to MAX_BRIEF_HOOKS hooks sorted by priority descending.
 * Returns [] when the dashboard has no matches or all guards fail.
 */
export function computeBriefHooks(
  stages: StageInfo[],
  dashboard: ShooterDashboardResponse,
  squadContext: SquadContext | null = null,
): BriefHook[] {
  const hooks: BriefHook[] = [];
  const { stats, matches } = dashboard;
  const recentMatches = matches.slice(0, 5);
  const hasEnoughHistory = matches.length >= MIN_MATCHES;

  // 1. Recent DQ -- safety-first, always highest priority.
  if (recentMatches.some((m) => m.dq)) {
    hooks.push({
      tag: "recent-dq",
      signal:
        "Had a DQ in recent matches -- review safety rules and procedural requirements before this match.",
      priority: 10,
    });
  }

  // 2. Constrained stages present in this match -- cross with penalty rate for context.
  const constrainedCount = countConstrainedStages(stages);
  if (constrainedCount > 0) {
    const penaltyNote =
      stats.avgPenaltyRate != null
        ? ` (career penalty rate: ${(stats.avgPenaltyRate * 100).toFixed(1)} per 100 rounds)`
        : "";
    hooks.push({
      tag: "constraint-stages",
      signal: `${constrainedCount} constrained stage${constrainedCount > 1 ? "s" : ""} (weak-hand, strong-hand, or unloaded start) in this match${penaltyNote} -- plan these deliberately.`,
      priority: 8,
    });
  }

  // 3. High penalty rate when no constraint context already covers it.
  if (
    hasEnoughHistory &&
    constrainedCount === 0 &&
    stats.avgPenaltyRate != null &&
    stats.avgPenaltyRate >= HIGH_PENALTY_RATE
  ) {
    hooks.push({
      tag: "penalty-rate",
      signal: `Career penalty rate is ${(stats.avgPenaltyRate * 100).toFixed(1)} per 100 rounds -- penalties are costing match %; prioritise clean runs over speed.`,
      priority: 7,
    });
  }

  // 4. Long stages with high variance -- stamina and consistency flag.
  const longCount = countLongStages(stages);
  if (
    hasEnoughHistory &&
    longCount > 0 &&
    stats.consistencyCV != null &&
    stats.consistencyCV >= HIGH_CV
  ) {
    hooks.push({
      tag: "long-stage-consistency",
      signal: `${longCount} long course stage${longCount > 1 ? "s" : ""} in this match; your consistency varies between matches (CV ${(stats.consistencyCV * 100).toFixed(0)}%) -- commit fully to each stage plan.`,
      priority: 6,
    });
  }

  // 5. Squad position -- timing and warm-up advice.
  if (squadContext && hasEnoughHistory) {
    const isLateInSquad = squadContext.position > Math.ceil(squadContext.squadSize / 2);
    const isDeclining =
      stats.hfTrendSlope != null && stats.hfTrendSlope < -0.002;

    if (isLateInSquad) {
      hooks.push({
        tag: "squad-timing",
        signal: isDeclining
          ? `Squad position ${squadContext.position} of ${squadContext.squadSize} (late in the rotation) and a declining performance trend -- plan an extended warm-up.`
          : `Squad position ${squadContext.position} of ${squadContext.squadSize} (later in the rotation) -- allow enough warm-up time before the first stage.`,
        priority: 5,
      });
    } else if (squadContext.startingStages.length > 0) {
      const stageList = squadContext.startingStages.join(", ");
      hooks.push({
        tag: "squad-starter",
        signal: `Starts first on stage${squadContext.startingStages.length > 1 ? "s" : ""} ${stageList} -- must be at full intensity from the opening buzzer; warm up accordingly.`,
        priority: 4,
      });
    }
  }

  hooks.sort((a, b) => b.priority - a.priority);
  return hooks.slice(0, MAX_BRIEF_HOOKS);
}
