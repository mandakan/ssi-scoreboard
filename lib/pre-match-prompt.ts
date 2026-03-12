// Pure functions — no I/O, no side effects.
// Builds the AI prompt for a pre-match coaching brief.

import type { StageInfo, ShooterDashboardResponse } from "@/lib/types";

/**
 * Bump when the prompt structure changes enough that cached briefs should
 * be regenerated. Embedded in the cache key alongside the model ID.
 */
export const PRE_MATCH_PROMPT_VERSION = 3;

/**
 * Within-squad starting-order context for one shooter.
 *
 * Convention: the competitor with the lowest bib number starts Stage 1,
 * second-lowest starts Stage 2, etc., wrapping around when squad size < stage count.
 * formula: starterIndex = (stage_number - 1) % squadSize
 */
export interface SquadContext {
  /** 1-indexed position in the squad (by competitor number). */
  position: number;
  /** Total number of competitors in the squad. */
  squadSize: number;
  /** Stage numbers (absolute) that this shooter starts. */
  startingStages: number[];
}

/**
 * Compute which stages a shooter starts given their 0-indexed squad position.
 * Pure function — no I/O.
 *
 * @param positionIdx  0-based index in the squad order (sorted by competitor number)
 * @param squadSize    Total number of competitors in the squad
 * @param stages       All stages in the match (used for stage_number values)
 */
export function computeSquadContext(
  positionIdx: number,
  squadSize: number,
  stages: StageInfo[],
): SquadContext {
  const startingStages = stages
    .filter((s) => (s.stage_number - 1) % squadSize === positionIdx)
    .map((s) => s.stage_number);
  return { position: positionIdx + 1, squadSize, startingStages };
}

export interface PreMatchBriefInput {
  matchName: string;
  matchLevel: string | null;
  stages: StageInfo[];
  /** Shooter name — null when identity is unknown. */
  shooterName: string | null;
  /** Historical dashboard data. Null when shooter has no indexed matches. */
  dashboard: ShooterDashboardResponse | null;
  /** Within-squad starting context. Null when squad is unknown or not yet assigned. */
  squadContext: SquadContext | null;
}

/** Summarise stage breakdown by course length. */
function summariseStageCourses(stages: StageInfo[]): string {
  const counts: Record<string, number> = {};
  const rounds: Record<string, number> = {};
  for (const s of stages) {
    const key = s.course_display ?? "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    rounds[key] = (rounds[key] ?? 0) + (s.min_rounds ?? 0);
  }
  const parts = Object.entries(counts).map(([label, n]) => {
    const r = rounds[label];
    return r > 0 ? `${n}×${label} (${r}r total)` : `${n}×${label}`;
  });
  return parts.join(", ");
}

/** List constrained stages (strong hand, weak hand, moving targets, unloaded start). */
function listConstraints(stages: StageInfo[]): string[] {
  const results: string[] = [];
  for (const s of stages) {
    const proc = s.procedure ?? "";
    const fc = s.firearm_condition ?? "";
    const tags: string[] = [];
    if (/unloaded|empty/i.test(fc)) tags.push("unloaded start");
    if (/strong hand/i.test(proc)) tags.push("strong hand only");
    if (/weak hand/i.test(proc)) tags.push("weak hand only");
    if (/moving target/i.test(proc)) tags.push("moving targets");
    if (tags.length > 0) {
      results.push(`Stage ${s.stage_number} (${tags.join(", ")})`);
    }
  }
  return results;
}

/**
 * Build the pre-match coaching brief prompt.
 * Pure function — no network calls.
 */
export function buildPreMatchBriefPrompt(input: PreMatchBriefInput): string {
  const { matchName, matchLevel, stages, shooterName, dashboard, squadContext } = input;

  const levelStr = matchLevel ?? "IPSC match";
  const courseBreakdown = summariseStageCourses(stages);
  const constraintLines = listConstraints(stages);
  const totalRounds = stages.reduce((s, st) => s + (st.min_rounds ?? 0), 0);

  let matchSection = `UPCOMING MATCH: ${matchName} (${levelStr})
STAGES: ${stages.length} stages — ${courseBreakdown}${totalRounds > 0 ? `, ${totalRounds} rounds total` : ""}`;

  if (constraintLines.length > 0) {
    matchSection += `\nSPECIAL STAGES: ${constraintLines.join("; ")}`;
  }

  // Squad starting context — tells the coach when the shooter is "hot" (goes first).
  if (squadContext) {
    const { position, squadSize, startingStages } = squadContext;
    matchSection += `\nSQUAD POSITION: ${position} of ${squadSize} (by competitor number)`;
    if (startingStages.length > 0) {
      matchSection += `\nSTAGES SHOOTER STARTS: ${startingStages.join(", ")} — goes first in the squad on these stages`;
    }
  }

  let competitorSection: string;
  if (!dashboard || !dashboard.profile) {
    competitorSection = shooterName
      ? `COMPETITOR: ${shooterName}\nHISTORY: No historical data available — provide general match preparation advice.`
      : `COMPETITOR: Unknown\nHISTORY: No historical data available — provide general match preparation advice.`;
  } else {
    const name = shooterName ?? dashboard.profile.name;
    const stats = dashboard.stats;

    // Division: prefer profile, fall back to most common in recent matches.
    const division =
      dashboard.profile.division ??
      (() => {
        const freq: Record<string, number> = {};
        for (const m of dashboard.matches) {
          if (m.division) freq[m.division] = (freq[m.division] ?? 0) + 1;
        }
        const entries = Object.entries(freq);
        return entries.length > 0
          ? entries.sort((a, b) => b[1] - a[1])[0][0]
          : null;
      })();

    const recentMatches = dashboard.matches.slice(0, 5);
    const recentPcts = recentMatches
      .filter((m) => m.matchPct != null)
      .map((m) => `${m.matchPct!.toFixed(0)}%`);

    const avgPct =
      stats.overallMatchPct != null
        ? `${stats.overallMatchPct.toFixed(0)}%`
        : "unknown";

    const trendStr =
      stats.hfTrendSlope == null
        ? "insufficient data"
        : stats.hfTrendSlope > 0.002
          ? "improving"
          : stats.hfTrendSlope < -0.002
            ? "declining"
            : "stable";

    const aZoneStr =
      stats.aPercent != null
        ? `${stats.aPercent.toFixed(0)}%`
        : "unknown";

    const consistencyStr =
      stats.consistencyCV == null
        ? "unknown"
        : stats.consistencyCV < 0.1
          ? "very consistent"
          : stats.consistencyCV < 0.2
            ? "consistent"
            : stats.consistencyCV < 0.3
              ? "moderate variance"
              : "high variance between matches";

    const penaltyStr =
      stats.avgPenaltyRate != null
        ? `${(stats.avgPenaltyRate * 100).toFixed(1)} per 100 rounds`
        : "unknown";

    const experienceStr =
      dashboard.matchCount >= 50
        ? "experienced (50+ L2+ matches)"
        : dashboard.matchCount >= 20
          ? `intermediate (${dashboard.matchCount} L2+ matches)`
          : `developing (${dashboard.matchCount} L2+ matches)`;

    competitorSection = `COMPETITOR: ${name}${division ? ` — ${division}` : ""}
EXPERIENCE: ${experienceStr}
CAREER MATCH AVERAGE: ${avgPct} (vs division winner)
RECENT RESULTS (last ${recentPcts.length} matches): ${recentPcts.length > 0 ? recentPcts.join(", ") : "none"}
PERFORMANCE TREND: ${trendStr}
A-ZONE ACCURACY: ${aZoneStr} of all hits
CONSISTENCY: ${consistencyStr}
PENALTY RATE: ${penaltyStr}`;
  }

  return `You are an IPSC performance coach preparing a competitor for a match.
Write a concise 2–3 sentence coaching brief (max 55 words). Be direct, specific to this match and competitor. No lists, no bullet points, no markdown. Focus on the most actionable preparation tip.

${matchSection}

${competitorSection}

PRE-MATCH BRIEF:`;
}
