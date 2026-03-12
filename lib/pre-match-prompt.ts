// Pure functions — no I/O, no side effects.
// Builds the AI prompt for a pre-match coaching brief.

import type { StageInfo, ShooterDashboardResponse } from "@/lib/types";

/**
 * Bump when the prompt structure changes enough that cached briefs should
 * be regenerated. Embedded in the cache key alongside the model ID.
 */
export const PRE_MATCH_PROMPT_VERSION = 1;

export interface PreMatchBriefInput {
  matchName: string;
  matchLevel: string | null;
  stages: StageInfo[];
  /** Shooter name — null when identity is unknown. */
  shooterName: string | null;
  /** Historical dashboard data. Null when shooter has no indexed matches. */
  dashboard: ShooterDashboardResponse | null;
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
  const { matchName, matchLevel, stages, shooterName, dashboard } = input;

  const levelStr = matchLevel ?? "IPSC match";
  const courseBreakdown = summariseStageCourses(stages);
  const constraintLines = listConstraints(stages);
  const totalRounds = stages.reduce((s, st) => s + (st.min_rounds ?? 0), 0);

  let matchSection = `UPCOMING MATCH: ${matchName} (${levelStr})
STAGES: ${stages.length} stages — ${courseBreakdown}${totalRounds > 0 ? `, ${totalRounds} rounds total` : ""}`;

  if (constraintLines.length > 0) {
    matchSection += `\nSPECIAL STAGES: ${constraintLines.join("; ")}`;
  }

  let competitorSection: string;
  if (!dashboard || !dashboard.profile) {
    competitorSection = shooterName
      ? `COMPETITOR: ${shooterName}\nHISTORY: No historical data available — provide general match preparation advice.`
      : `COMPETITOR: Unknown\nHISTORY: No historical data available — provide general match preparation advice.`;
  } else {
    const name = shooterName ?? dashboard.profile.name;
    const stats = dashboard.stats;
    const recentMatches = dashboard.matches.slice(0, 5);
    const recentPcts = recentMatches
      .filter((m) => m.matchPct != null)
      .map((m) => `${m.matchPct!.toFixed(0)}%`);

    const trendStr =
      stats.hfTrendSlope == null
        ? "insufficient data"
        : stats.hfTrendSlope > 0.002
          ? "improving"
          : stats.hfTrendSlope < -0.002
            ? "declining"
            : "stable";

    const penaltyStr =
      stats.avgPenaltyRate != null
        ? `${(stats.avgPenaltyRate * 100).toFixed(1)} per 100 rounds`
        : "unknown";

    const avgPct =
      stats.overallMatchPct != null
        ? `${stats.overallMatchPct.toFixed(0)}%`
        : "unknown";

    competitorSection = `COMPETITOR: ${name}
CAREER MATCH AVERAGE: ${avgPct} (vs division winner)
RECENT RESULTS (last ${recentPcts.length} matches): ${recentPcts.length > 0 ? recentPcts.join(", ") : "none"}
PERFORMANCE TREND: ${trendStr}
PENALTY RATE: ${penaltyStr}`;
  }

  return `You are an IPSC performance coach preparing a competitor for a match.
Write a concise 2–3 sentence coaching brief (max 55 words). Be direct, specific to this match and competitor. No lists, no bullet points, no markdown. Focus on the most actionable preparation tip.

${matchSection}

${competitorSection}

PRE-MATCH BRIEF:`;
}
