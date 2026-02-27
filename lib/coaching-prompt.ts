// Pure functions — no I/O, no side effects. Fully unit-tested.
// Extracted following the app/api/compare/logic.ts pattern.

import type {
  CompetitorInfo,
  StageComparison,
  CompetitorPenaltyStats,
  ConsistencyStats,
  StyleFingerprintStats,
} from "@/lib/types";

export interface CoachingPromptInput {
  competitor: CompetitorInfo;
  stages: StageComparison[];
  penaltyStats: CompetitorPenaltyStats;
  consistencyStats: ConsistencyStats;
  styleFingerprint: StyleFingerprintStats;
  matchName: string;
}

/**
 * Assemble a coaching prompt from competitor performance data.
 * Returns the user-message string to send to the AI provider.
 */
export function buildCoachingPrompt(input: CoachingPromptInput): string {
  const {
    competitor,
    stages,
    penaltyStats,
    consistencyStats,
    styleFingerprint,
    matchName,
  } = input;

  const stageLines = stages
    .map((s) => {
      const cs = s.competitors[competitor.id];
      if (!cs) return null;
      if (cs.dq) return `  Stage ${s.stage_num} "${s.stage_name}": DQ`;
      if (cs.dnf) return `  Stage ${s.stage_num} "${s.stage_name}": DNF`;

      const parts = [
        `HF ${cs.hit_factor?.toFixed(2) ?? "—"}`,
        `${cs.group_percent?.toFixed(1) ?? "—"}% of group leader`,
        cs.a_hits != null
          ? `A:${cs.a_hits} C:${cs.c_hits} D:${cs.d_hits} M:${cs.miss_count}`
          : null,
        cs.time != null ? `time ${cs.time.toFixed(2)}s` : null,
        cs.stageClassification ? `(${cs.stageClassification})` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return `  Stage ${s.stage_num} "${s.stage_name}": ${parts}`;
    })
    .filter(Boolean);

  const lines = [
    `Match: ${matchName}`,
    `Competitor: ${competitor.name}${competitor.division ? ` (${competitor.division})` : ""}`,
    `Overall match average: ${penaltyStats.matchPctActual.toFixed(1)}% of group leader`,
    `Penalty rate: ${penaltyStats.penaltiesPer100Rounds.toFixed(1)} per 100 rounds (${penaltyStats.totalPenalties} total)`,
    consistencyStats.label
      ? `Consistency: ${consistencyStats.label} (CV ${consistencyStats.coefficientOfVariation?.toFixed(3) ?? "—"})`
      : null,
    styleFingerprint.archetype
      ? `Style archetype: ${styleFingerprint.archetype}`
      : null,
    "",
    "Per-stage breakdown:",
    ...stageLines,
    "",
    "Instructions:",
    "Write 1-2 sentences of specific, actionable coaching advice for this competitor based on their stage results above.",
    "Focus on their individual performance patterns — what went well and what to improve.",
    "Be encouraging but direct. Do NOT compare them to other competitors.",
    "Do not include the competitor's name in your response.",
  ];

  return lines.filter((l) => l !== null).join("\n");
}

/**
 * Check whether a competitor is eligible for coaching tips.
 * Returns null if eligible, or a string reason if not.
 */
export function checkCoachingEligibility(
  scoringCompleted: number,
  daysSince: number,
  stages: StageComparison[],
  competitorId: number,
): string | null {
  const isComplete = scoringCompleted >= 95 || daysSince > 3;
  if (!isComplete) return "Match scoring is not yet complete";

  const missingStages = stages.filter((s) => !s.competitors[competitorId]);
  if (missingStages.length > 0) return "Missing scorecards on some stages";

  const isDq = stages.some((s) => s.competitors[competitorId]?.dq);
  if (isDq) return "Disqualified competitors are excluded";

  return null;
}
