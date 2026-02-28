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
 * Classify a stage as short / medium / long course using min_rounds when
 * available, falling back to an estimate from max_points.
 */
function courseSize(stage: StageComparison): string {
  const r = stage.min_rounds;
  if (r != null) {
    if (r <= 8) return "short course";
    if (r <= 16) return "medium course";
    return "long course";
  }
  // Fallback: 2 rounds per paper target, each worth 10 pts max
  if (stage.max_points <= 80) return "short course";
  if (stage.max_points <= 160) return "medium course";
  return "long course";
}

/** Build the shared per-stage breakdown used by both coach and roast prompts. */
function buildStageLines(
  stages: StageComparison[],
  competitorId: number,
): string[] {
  return stages
    .map((s) => {
      const cs = s.competitors[competitorId];
      if (!cs) return null;

      const stageMeta = `${s.stageDifficultyLabel}, ${courseSize(s)}`;

      if (cs.dq)
        return `  Stage ${s.stage_num} "${s.stage_name}" [${stageMeta}]: DQ`;
      if (cs.dnf)
        return `  Stage ${s.stage_num} "${s.stage_name}" [${stageMeta}]: DNF`;

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

      return `  Stage ${s.stage_num} "${s.stage_name}" [${stageMeta}]: ${parts}`;
    })
    .filter((l): l is string => l !== null);
}

/** Build the shared context header used by both prompts. */
function buildContextHeader(input: CoachingPromptInput): string[] {
  const { competitor, penaltyStats, consistencyStats, styleFingerprint, matchName } = input;

  return [
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
  ].filter((l): l is string => l !== null);
}

/**
 * Assemble a coaching prompt from competitor performance data.
 * Returns the user-message string to send to the AI provider.
 */
export function buildCoachingPrompt(input: CoachingPromptInput): string {
  const stageLines = buildStageLines(input.stages, input.competitor.id);

  const lines = [
    ...buildContextHeader(input),
    "",
    "Per-stage breakdown (difficulty and course length in brackets):",
    ...stageLines,
    "",
    "Instructions:",
    "Write 3-4 sentences of specific, actionable coaching advice for this competitor.",
    "You are a professional IPSC coach reviewing post-match performance data.",
    "Focus on their individual performance patterns — what went well, what to improve, and one concrete drill or technique to work on.",
    "Reference specific stages where relevant, considering the stage difficulty and course length.",
    "Be encouraging but direct. Do NOT compare them to other competitors.",
    "Do not include the competitor's name in your response.",
  ];

  return lines.join("\n");
}

/**
 * Assemble a roast prompt from competitor performance data.
 * Same input as buildCoachingPrompt but with a humorous, friendly roasting tone.
 */
export function buildRoastPrompt(input: CoachingPromptInput): string {
  const stageLines = buildStageLines(input.stages, input.competitor.id);

  const lines = [
    ...buildContextHeader(input),
    "",
    "Per-stage breakdown (difficulty and course length in brackets):",
    ...stageLines,
    "",
    "Instructions:",
    "Write 3-4 sentences roasting this competitor's performance in a friendly, humorous way.",
    "You are a witty fellow IPSC shooter who loves banter and knows the sport inside out.",
    "Reference specific stage results — hit zone counts, timing disasters, penalty magnets, or how they handled (or didn't handle) the harder stages — to make the roast feel personal and IPSC-specific.",
    "Keep it light — the goal is to make them laugh at their own mistakes, not feel genuinely bad.",
    "Do NOT compare them to other competitors by name.",
    "Do not include the competitor's name in your response.",
  ];

  return lines.join("\n");
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
