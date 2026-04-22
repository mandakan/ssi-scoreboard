// Pure functions — no I/O, no side effects. Fully unit-tested.
// Extracted following the app/api/compare/logic.ts pattern.

import { isMatchComplete } from "@/lib/match-ttl";
import type {
  CompetitorInfo,
  StageComparison,
  CompetitorPenaltyStats,
  ConsistencyStats,
  StyleFingerprintStats,
  CourseLengthPerformance,
  ConstraintPerformance,
  StageDegradationData,
  MatchWeatherData,
} from "@/lib/types";

/**
 * Bump this whenever the prompt structure changes significantly enough that
 * previously cached coaching tips should be regenerated.
 * Embedded in the coaching cache key alongside the model ID.
 */
export const COACHING_PROMPT_VERSION = 3;

export interface CoachingPromptInput {
  competitor: CompetitorInfo;
  stages: StageComparison[];
  penaltyStats: CompetitorPenaltyStats;
  consistencyStats: ConsistencyStats;
  styleFingerprint: StyleFingerprintStats;
  matchName: string;
  /** Total competitors in the field — used to decide whether to hedge the archetype label. */
  fieldSize: number;
  // ── Phase 1: contextual data ─────────────────────────────────────────────
  /** Per-stage full-field shooting-order vs HF correlation data. Null if not available. */
  stageDegradationData: StageDegradationData[] | null;
  /** Competitor's average performance split by short / medium / long course. Empty array if no data. */
  courseLengthPerformance: CourseLengthPerformance[];
  /** Constrained-stage (weak-hand, moving targets, etc.) vs normal-stage performance delta. */
  constraintPerformance: ConstraintPerformance | null;
  /** Stage 1 group_percent minus the competitor's match average group_percent.
   *  Negative = first stage below average (possible nerves). Null if not computable. */
  firstStageDelta: number | null;
  /** Time-of-day when this competitor started shooting (UTC-derived, approximate). */
  timeOfDayLabel: string | null;
  /** Hours elapsed from competitor's first to last scored stage. Null if < 30 minutes or no timestamps. */
  sessionDurationHours: number | null;
  /** Historical weather data for the match day. Null if coordinates unavailable or fetch failed. */
  weatherContext: MatchWeatherData | null;
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

/**
 * Derive shooting-order context for the competitor.
 * Returns a single summary line, or null if there's nothing actionable to report.
 */
function buildShootingOrderLine(
  stages: StageComparison[],
  competitorId: number,
  stageDegradationData: StageDegradationData[] | null,
): string | null {
  if (!stageDegradationData || stageDegradationData.length === 0) return null;

  // Compute average relative shooting position (0–1) across all stages with data
  const relativePositions: number[] = [];
  for (const s of stages) {
    const cs = s.competitors[competitorId];
    if (cs?.shooting_order != null && s.field_competitor_count > 1) {
      relativePositions.push(cs.shooting_order / s.field_competitor_count);
    }
  }
  if (relativePositions.length === 0) return null;

  const avgRelPos =
    relativePositions.reduce((a, b) => a + b, 0) / relativePositions.length;

  // Count stages where late shooting significantly correlates with lower HF (spearmanR < 0)
  const sigNegStages = stageDegradationData.filter(
    (s) => s.spearmanSignificant && s.spearmanR !== null && s.spearmanR < 0,
  ).length;

  // Only surface this line when there's an actionable pattern:
  // competitor shot late AND there is at least one stage with a significant degradation effect
  if (avgRelPos <= 0.5 || sigNegStages === 0) return null;

  const pct = Math.round(avgRelPos * 100);
  return `Shooting order: typically shot late in the field (avg ${pct}% through); degradation correlation on ${sigNegStages} stage${sigNegStages > 1 ? "s" : ""} — later shooting position correlates with lower HF`;
}

/**
 * Format a MatchWeatherData summary into a multi-line prompt block.
 * Pure function — exported for unit testing.
 *
 * Note: weather applies to outdoor matches only. Some Level 1–2 matches may be
 * indoors, in which case the AI coach should treat this context as less relevant.
 */
export function formatWeatherBlock(w: MatchWeatherData): string {
  const lines: string[] = [];

  // Header: date and elevation
  lines.push(`Match-day conditions (${w.date}, ${w.elevation} m elevation):`);

  // Weather summary + precipitation
  const precipLine = (() => {
    const duringMatch =
      w.precipitationTotal != null && w.precipitationTotal > 0
        ? `${w.precipitationTotal.toFixed(1)} mm during match hours`
        : null;
    const fullDay =
      w.precipitationDayTotal != null && w.precipitationDayTotal > 0
        ? `${w.precipitationDayTotal.toFixed(1)} mm total on the day`
        : null;
    if (duringMatch && fullDay && duringMatch !== fullDay)
      return `${duringMatch} (${fullDay})`;
    return duringMatch ?? fullDay ?? "no precipitation";
  })();
  lines.push(
    `  Sky/weather: ${w.weatherLabel ?? "unknown"}, precipitation: ${precipLine}`,
  );

  // Snow (only if present)
  if (w.snowDepthMax != null && w.snowDepthMax > 0) {
    lines.push(`  Snow depth: ${(w.snowDepthMax * 100).toFixed(0)} cm`);
  }

  // Temperature + humidity
  const tempStr = w.tempRange
    ? `${w.tempRange[0]}–${w.tempRange[1]}°C`
    : "unknown";
  const feelsStr = w.apparentTempRange
    ? ` (feels-like ${w.apparentTempRange[0]}–${w.apparentTempRange[1]}°C)`
    : "";
  const humidStr =
    w.humidityAvg != null ? `, humidity ${w.humidityAvg}%` : "";
  const wetbulbStr =
    w.wetbulbMax != null
      ? `, wet-bulb max ${w.wetbulbMax.toFixed(1)}°C${w.wetbulbMax > 28 ? " ⚠ heat stress risk" : ""}`
      : "";
  lines.push(`  Temperature: ${tempStr}${feelsStr}${humidStr}${wetbulbStr}`);

  // Wind
  const windAvgStr =
    w.windspeedAvg != null ? `${w.windspeedAvg.toFixed(1)} m/s avg` : "unknown";
  const windGustStr =
    w.windgustMax != null ? `, gusting ${w.windgustMax.toFixed(1)} m/s` : "";
  const windDirStr =
    w.winddirectionDominant ? ` from ${w.winddirectionDominant}` : "";
  lines.push(`  Wind: ${windAvgStr}${windGustStr}${windDirStr}`);

  // Solar radiation (proxy for glare/sun exposure)
  if (w.solarRadiationAvg != null) {
    const glareNote =
      w.solarRadiationAvg > 400
        ? " (strong direct sun — glare risk on sun-facing stages)"
        : w.solarRadiationAvg > 150
          ? " (moderate direct sun)"
          : " (low/no direct sun)";
    lines.push(`  Solar radiation: ${w.solarRadiationAvg.toFixed(0)} W/m² avg${glareNote}`);
  }

  // Visibility (only if reduced: < 10 km)
  if (w.visibilityMin != null && w.visibilityMin < 10_000) {
    const km = (w.visibilityMin / 1000).toFixed(1);
    lines.push(`  Visibility: ${km} km (reduced)`);
  }

  // Daylight context: sunrise/sunset relative to match hours
  if (w.sunrise && w.sunset) {
    lines.push(`  Daylight: sunrise ${w.sunrise} – sunset ${w.sunset} UTC`);
  }

  // Cloud cover (only if notable: fully overcast or mostly clear)
  if (w.cloudcoverAvg != null) {
    const cloudDesc =
      w.cloudcoverAvg >= 80
        ? "overcast"
        : w.cloudcoverAvg >= 50
          ? "mostly cloudy"
          : w.cloudcoverAvg >= 20
            ? "partly cloudy"
            : "mostly clear";
    if (w.cloudcoverAvg >= 80 || w.cloudcoverAvg < 20) {
      lines.push(`  Cloud cover: ${cloudDesc} (${w.cloudcoverAvg}% avg)`);
    }
  }

  return lines.join("\n");
}

/** Build the shared context header used by both prompts. */
function buildContextHeader(input: CoachingPromptInput): string[] {
  const {
    competitor,
    penaltyStats,
    consistencyStats,
    styleFingerprint,
    matchName,
    fieldSize,
    stageDegradationData,
    courseLengthPerformance,
    constraintPerformance,
    firstStageDelta,
    timeOfDayLabel,
    sessionDurationHours,
    weatherContext,
  } = input;

  // A DQ is a match-wide safety disqualification — all stages after the infraction are also
  // auto-DQ'd. Surface this explicitly so the AI doesn't misread a run of DQ stages as
  // repeated individual stage failures.
  const hasDq = input.stages.some((s) => s.competitors[competitor.id]?.dq);

  // Course-length split (only if ≥ 2 course types have data)
  const clpEntries = courseLengthPerformance.filter(
    (clp) => clp.avgGroupPercent != null,
  );
  const courseLengthLine =
    clpEntries.length >= 2
      ? `Course-length performance: ${clpEntries.map((clp) => `${clp.courseDisplay} ${clp.avgGroupPercent!.toFixed(1)}%`).join(" | ")}`
      : null;

  // Constraint performance (only if constrained stages exist and both averages are available)
  const constraintLine = (() => {
    const cp = constraintPerformance;
    if (!cp || cp.constrained.stageCount === 0) return null;
    if (
      cp.normal.avgGroupPercent == null ||
      cp.constrained.avgGroupPercent == null
    )
      return null;
    const delta = cp.constrained.avgGroupPercent - cp.normal.avgGroupPercent;
    const sign = delta >= 0 ? "+" : "";
    return `Constrained stages (weak-hand, moving targets, etc.): avg ${cp.constrained.avgGroupPercent.toFixed(1)}% (${sign}${delta.toFixed(1)}% vs ${cp.normal.avgGroupPercent.toFixed(1)}% on normal stages)`;
  })();

  // First-stage delta (only if meaningful: |delta| >= 5%)
  const firstStageLine = (() => {
    if (firstStageDelta == null || Math.abs(firstStageDelta) < 5) return null;
    const sign = firstStageDelta >= 0 ? "+" : "";
    const context =
      firstStageDelta < -10
        ? " — possible first-stage nerves"
        : firstStageDelta < 0
          ? " — slightly below average start"
          : " — strong opener";
    return `Stage 1 vs match average: ${sign}${firstStageDelta.toFixed(1)}%${context}`;
  })();

  // Shooting order context
  const shootingOrderLine = buildShootingOrderLine(
    input.stages,
    competitor.id,
    stageDegradationData,
  );

  // Session timing (combine time-of-day and duration into one line)
  const sessionLine = (() => {
    const parts: string[] = [];
    if (timeOfDayLabel) parts.push(timeOfDayLabel);
    if (sessionDurationHours != null)
      parts.push(`${sessionDurationHours.toFixed(1)}h range day`);
    if (parts.length === 0) return null;
    return `Match timing: ${parts.join(", ")}`;
  })();

  return [
    `Match: ${matchName}`,
    `Competitor: ${competitor.name}${competitor.division ? ` (${competitor.division})` : ""}`,
    hasDq
      ? `Note: Competitor received a DQ (safety disqualification) during this match — all stages from the infraction onward are also marked DQ and do not reflect shooting performance.`
      : null,
    `Overall match average: ${penaltyStats.matchPctActual.toFixed(1)}% of group leader`,
    `Penalty rate: ${penaltyStats.penaltiesPer100Rounds.toFixed(1)} per 100 rounds (${penaltyStats.totalPenalties} total)`,
    // Omit consistency when stagesFired < 6 — CV is unreliable with a small sample (matches
    // the UI opacity-40 dimming threshold).
    consistencyStats.label && consistencyStats.stagesFired >= 6
      ? `Consistency: ${consistencyStats.label} (CV ${consistencyStats.coefficientOfVariation?.toFixed(3) ?? "—"})`
      : null,
    // Hedge archetype label when the field is too small to be statistically reliable (matches
    // the UI "tends toward X" hedging threshold of < 25 competitors).
    styleFingerprint.archetype
      ? fieldSize < 25
        ? `Style archetype: tends toward ${styleFingerprint.archetype} (small field, n=${fieldSize})`
        : `Style archetype: ${styleFingerprint.archetype}`
      : null,
    // Phase 1 contextual enrichment
    courseLengthLine,
    constraintLine,
    firstStageLine,
    shootingOrderLine,
    sessionLine,
    // Phase 2: weather context (null when coordinates unavailable or match may be indoor)
    weatherContext ? formatWeatherBlock(weatherContext) : null,
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
    "Per-stage breakdown (difficulty and course length in brackets; DQ = safety disqualification ending the match, DNF = did not finish this specific stage):",
    ...stageLines,
    "",
    "Instructions:",
    "Write 3-4 sentences of specific, actionable coaching advice for this competitor.",
    "You are a professional IPSC coach reviewing post-match performance data.",
    "Focus on their individual performance patterns — what went well, what to improve, and one concrete drill or technique to work on.",
    "Reference specific stages where relevant, considering the stage difficulty and course length.",
    "Use contextual factors (course length splits, constraint performance, session timing, shooting order, weather) where they reveal a clear pattern worth addressing.",
    "If match-day conditions are shown, factor in environmental stressors (cold, wind, rain, heat) — but only reference them if they plausibly explain a performance pattern. If the match may have been indoors (e.g. small Level 1–2 club match), you may skip weather context.",
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
    "Per-stage breakdown (difficulty and course length in brackets; DQ = safety disqualification ending the match, DNF = did not finish this specific stage):",
    ...stageLines,
    "",
    "Instructions:",
    "Write 3-4 sentences roasting this competitor's performance in a friendly, humorous way.",
    "You are a witty fellow IPSC shooter who loves banter and knows the sport inside out.",
    "Reference specific stage results — hit zone counts, timing disasters, penalty magnets, or how they handled (or didn't handle) the harder stages — to make the roast feel personal and IPSC-specific.",
    "Feel free to riff on contextual patterns (course length weakness, constraint struggles, late-match fatigue) if they're entertainingly bad.",
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
  if (!isMatchComplete(scoringCompleted, daysSince))
    return "Match scoring is not yet complete";

  const missingStages = stages.filter((s) => !s.competitors[competitorId]);
  if (missingStages.length > 0) return "Missing scorecards on some stages";

  return null;
}
