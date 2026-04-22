import { describe, it, expect } from "vitest";
import {
  buildCoachingPrompt,
  buildRoastPrompt,
  checkCoachingEligibility,
  formatWeatherBlock,
  type CoachingPromptInput,
} from "@/lib/coaching-prompt";
import type {
  CompetitorInfo,
  StageComparison,
  CompetitorPenaltyStats,
  ConsistencyStats,
  StyleFingerprintStats,
  CompetitorSummary,
  CourseLengthPerformance,
  ConstraintPerformance,
  StageDegradationData,
  MatchWeatherData,
} from "@/lib/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCompetitor(overrides?: Partial<CompetitorInfo>): CompetitorInfo {
  return {
    id: 100,
    shooterId: null,
    name: "John Doe",
    competitor_number: "42",
    club: "Shooters United",
    division: "Production",
    region: null,
    region_display: null,
    category: null,
    ics_alias: null,
    license: null,
    ...overrides,
  };
}

function makeSummary(
  overrides?: Partial<CompetitorSummary>,
): CompetitorSummary {
  return {
    competitor_id: 100,
    points: 80,
    hit_factor: 4.0,
    time: 20.0,
    group_rank: 1,
    group_percent: 100,
    div_rank: 5,
    div_percent: 85,
    overall_rank: 10,
    overall_percent: 75,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 10,
    c_hits: 2,
    d_hits: 1,
    miss_count: 0,
    no_shoots: 0,
    procedurals: 0,
    overall_percentile: 0.8,
    stageClassification: "solid",
    hitLossPoints: 5,
    penaltyLossPoints: 0,
    ...overrides,
  };
}

function makeStage(
  stageNum: number,
  competitorSummary: CompetitorSummary | null,
  competitorId = 100,
): StageComparison {
  return {
    stage_id: stageNum * 100,
    stage_name: `Stage ${stageNum}`,
    stage_num: stageNum,
    max_points: 100,
    group_leader_hf: 5.0,
    group_leader_points: 100,
    overall_leader_hf: 6.0,
    field_median_hf: 3.5,
    field_median_accuracy: null,
    field_cv: null,
    field_competitor_count: 50,
    stageDifficultyLevel: 3,
    stageDifficultyLabel: "hard",
    stageSeparatorLevel: 2 as const,
    competitors: competitorSummary
      ? { [competitorId]: competitorSummary }
      : {},
  };
}

function makePenaltyStats(
  overrides?: Partial<CompetitorPenaltyStats>,
): CompetitorPenaltyStats {
  return {
    totalPenalties: 3,
    penaltyCostPercent: 2.5,
    matchPctActual: 85.0,
    matchPctClean: 87.5,
    penaltiesPerStage: 0.5,
    penaltiesPer100Rounds: 2.0,
    ...overrides,
  };
}

function makeConsistencyStats(
  overrides?: Partial<ConsistencyStats>,
): ConsistencyStats {
  return {
    coefficientOfVariation: 0.15,
    label: "consistent",
    stagesFired: 6,
    ...overrides,
  };
}

function makeStyleFingerprint(
  overrides?: Partial<StyleFingerprintStats>,
): StyleFingerprintStats {
  return {
    alphaRatio: 0.75,
    pointsPerSecond: 4.5,
    penaltyRate: 0.02,
    totalA: 60,
    totalC: 15,
    totalD: 5,
    totalPoints: 480,
    totalTime: 106.7,
    totalPenalties: 3,
    totalRounds: 150,
    stagesFired: 6,
    accuracyPercentile: 70,
    speedPercentile: 60,
    archetype: "Surgeon",
    composurePercentile: 80,
    consistencyPercentile: 75,
    ...overrides,
  };
}

function makeCourseLength(overrides?: Partial<CourseLengthPerformance>): CourseLengthPerformance {
  return {
    courseDisplay: "Short",
    stageCount: 2,
    avgGroupPercent: 88.0,
    avgDivPercent: 82.0,
    avgOverallPercent: 78.0,
    ...overrides,
  };
}

function makeConstraintPerformance(
  overrides?: Partial<ConstraintPerformance>,
): ConstraintPerformance {
  return {
    normal: { stageCount: 4, avgGroupPercent: 85.0 },
    constrained: { stageCount: 2, avgGroupPercent: 72.0 },
    ...overrides,
  };
}

function makeStageDegradation(overrides?: Partial<StageDegradationData>): StageDegradationData {
  return {
    stageId: 100,
    stageNum: 1,
    stageName: "Stage 1",
    points: [
      { competitorId: 100, shootingPosition: 1, hfPercent: 95 },
      { competitorId: 200, shootingPosition: 2, hfPercent: 88 },
    ],
    spearmanR: -0.8,
    spearmanSignificant: true,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<CoachingPromptInput>): CoachingPromptInput {
  return {
    competitor: makeCompetitor(),
    stages: [
      makeStage(1, makeSummary()),
      makeStage(2, makeSummary({ hit_factor: 3.5, group_percent: 70 })),
    ],
    penaltyStats: makePenaltyStats(),
    consistencyStats: makeConsistencyStats(),
    styleFingerprint: makeStyleFingerprint(),
    matchName: "Test Cup 2026",
    fieldSize: 30, // >= 25 so archetype is not hedged by default
    // Phase 1 contextual data — null/empty defaults so existing tests are unaffected
    stageDegradationData: null,
    courseLengthPerformance: [],
    constraintPerformance: null,
    firstStageDelta: null,
    timeOfDayLabel: null,
    sessionDurationHours: null,
    weatherContext: null,
    ...overrides,
  };
}

// ── buildCoachingPrompt tests ──────────────────────────────────────────────────

describe("buildCoachingPrompt", () => {
  it("includes competitor name and division", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("John Doe (Production)");
  });

  it("includes match name", () => {
    const prompt = buildCoachingPrompt(makeInput({ matchName: "Nationals 2026" }));
    expect(prompt).toContain("Match: Nationals 2026");
  });

  it("includes per-stage HF and group percent", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("HF 4.00");
    expect(prompt).toContain("100.0% of group leader");
    expect(prompt).toContain("HF 3.50");
    expect(prompt).toContain("70.0% of group leader");
  });

  it("includes zone counts when available", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("A:10 C:2 D:1 M:0");
  });

  it("includes penalty rate", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("2.0 per 100 rounds");
    expect(prompt).toContain("3 total");
  });

  it("includes consistency label when available", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("Consistency: consistent (CV 0.150)");
  });

  it("omits consistency line when label is null", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        consistencyStats: makeConsistencyStats({
          label: null,
          coefficientOfVariation: null,
        }),
      }),
    );
    expect(prompt).not.toContain("Consistency:");
  });

  it("includes archetype when available", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("Style archetype: Surgeon");
  });

  it("omits archetype line when null", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        styleFingerprint: makeStyleFingerprint({ archetype: null }),
      }),
    );
    expect(prompt).not.toContain("Style archetype:");
  });

  it("hedges archetype with 'tends toward' when fieldSize < 25", () => {
    const prompt = buildCoachingPrompt(makeInput({ fieldSize: 20 }));
    expect(prompt).toContain("Style archetype: tends toward Surgeon (small field, n=20)");
  });

  it("does not hedge archetype when fieldSize is exactly 25", () => {
    const prompt = buildCoachingPrompt(makeInput({ fieldSize: 25 }));
    expect(prompt).toContain("Style archetype: Surgeon");
    expect(prompt).not.toContain("tends toward");
  });

  it("omits consistency when stagesFired < 6 (unreliable CV)", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        consistencyStats: makeConsistencyStats({ stagesFired: 5 }),
      }),
    );
    expect(prompt).not.toContain("Consistency:");
  });

  it("includes consistency when stagesFired is exactly 6", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        consistencyStats: makeConsistencyStats({ stagesFired: 6 }),
      }),
    );
    expect(prompt).toContain("Consistency: consistent (CV 0.150)");
  });

  it("adds DQ context note when competitor has a DQ stage", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [
          makeStage(1, makeSummary()),
          makeStage(2, makeSummary({ dq: true })),
          makeStage(3, makeSummary({ dq: true })),
        ],
      }),
    );
    // Context header note (unique phrase only present when competitor has a DQ)
    expect(prompt).toContain("stages from the infraction onward are also marked DQ");
  });

  it("omits DQ context note when no DQ stages", () => {
    const prompt = buildCoachingPrompt(makeInput());
    // The per-stage label always mentions DQ terminology, but the context header note
    // with this phrase should only appear when the competitor actually has a DQ stage.
    expect(prompt).not.toContain("stages from the infraction onward");
  });

  it("includes DQ/DNF terminology in per-stage section label", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("DQ = safety disqualification ending the match");
    expect(prompt).toContain("DNF = did not finish this specific stage");
  });

  it("includes stage classification when present", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("(solid)");
  });

  it("handles DQ stages", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [makeStage(1, makeSummary({ dq: true }))],
      }),
    );
    // Format is now: Stage N "name" [difficulty, course]: DQ
    expect(prompt).toMatch(/Stage 1 "Stage 1" \[.*\]: DQ/);
  });

  it("handles DNF stages", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [makeStage(1, makeSummary({ dnf: true }))],
      }),
    );
    expect(prompt).toMatch(/Stage 1 "Stage 1" \[.*\]: DNF/);
  });

  it("skips stages where competitor has no scorecard", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [
          makeStage(1, makeSummary()),
          makeStage(2, null), // no scorecard for competitor
        ],
      }),
    );
    expect(prompt).toContain("Stage 1");
    expect(prompt).not.toContain("Stage 2");
  });

  it("handles competitor without division", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        competitor: makeCompetitor({ division: null }),
      }),
    );
    expect(prompt).toContain("Competitor: John Doe\n");
    expect(prompt).not.toContain("(null)");
  });

  it("includes instruction block", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).toContain("Write 3-4 sentences");
    expect(prompt).toContain("professional IPSC coach");
    expect(prompt).toContain("Do NOT compare them to other competitors");
    expect(prompt).toContain("Do not include the competitor's name");
  });

  it("includes stage difficulty and course size", () => {
    const prompt = buildCoachingPrompt(makeInput());
    // stageDifficultyLabel = "hard", min_rounds = null, max_points = 100 → medium course
    expect(prompt).toContain("[hard, medium course]");
  });

  it("uses min_rounds to determine short course when available", () => {
    const input = makeInput({
      stages: [
        {
          ...makeStage(1, makeSummary()),
          min_rounds: 8,
          stageDifficultyLabel: "easy",
        },
      ],
    });
    const prompt = buildCoachingPrompt(input);
    expect(prompt).toContain("[easy, short course]");
  });

  it("uses min_rounds to determine long course when available", () => {
    const input = makeInput({
      stages: [
        {
          ...makeStage(1, makeSummary()),
          min_rounds: 32,
          stageDifficultyLabel: "hard",
        },
      ],
    });
    const prompt = buildCoachingPrompt(input);
    expect(prompt).toContain("[hard, long course]");
  });

  it("handles stages with null zone data", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [
          makeStage(
            1,
            makeSummary({
              a_hits: null,
              c_hits: null,
              d_hits: null,
              miss_count: null,
            }),
          ),
        ],
      }),
    );
    expect(prompt).toContain("HF 4.00");
    expect(prompt).not.toContain("A:null");
  });
});

// ── Phase 1 contextual enrichment ─────────────────────────────────────────────

describe("course-length performance line", () => {
  it("omits course-length line when fewer than 2 course types have data", () => {
    const prompt = buildCoachingPrompt(
      makeInput({ courseLengthPerformance: [makeCourseLength()] }),
    );
    expect(prompt).not.toContain("Course-length performance:");
  });

  it("includes course-length line when >= 2 course types have data", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        courseLengthPerformance: [
          makeCourseLength({ courseDisplay: "Short", avgGroupPercent: 88.0 }),
          makeCourseLength({ courseDisplay: "Long", avgGroupPercent: 71.5 }),
        ],
      }),
    );
    expect(prompt).toContain("Course-length performance: Short 88.0% | Long 71.5%");
  });

  it("omits course type if avgGroupPercent is null", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        courseLengthPerformance: [
          makeCourseLength({ courseDisplay: "Short", avgGroupPercent: 88.0 }),
          makeCourseLength({ courseDisplay: "Medium", avgGroupPercent: null }),
          makeCourseLength({ courseDisplay: "Long", avgGroupPercent: 71.5 }),
        ],
      }),
    );
    // Only Short and Long have data — still >= 2 entries after filtering
    expect(prompt).toContain("Course-length performance: Short 88.0% | Long 71.5%");
    expect(prompt).not.toContain("Medium");
  });
});

describe("constraint performance line", () => {
  it("omits constraint line when constraintPerformance is null", () => {
    const prompt = buildCoachingPrompt(makeInput({ constraintPerformance: null }));
    expect(prompt).not.toContain("Constrained stages");
  });

  it("omits constraint line when constrained stageCount is 0", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        constraintPerformance: makeConstraintPerformance({
          constrained: { stageCount: 0, avgGroupPercent: null },
        }),
      }),
    );
    expect(prompt).not.toContain("Constrained stages");
  });

  it("includes constraint line with delta when constrained stages exist", () => {
    const prompt = buildCoachingPrompt(
      makeInput({ constraintPerformance: makeConstraintPerformance() }),
    );
    // 72% constrained vs 85% normal = -13%
    expect(prompt).toContain("Constrained stages (weak-hand, moving targets, etc.): avg 72.0% (-13.0% vs 85.0% on normal stages)");
  });

  it("shows positive delta when constrained outperforms normal", () => {
    const prompt = buildCoachingPrompt(
      makeInput({
        constraintPerformance: makeConstraintPerformance({
          normal: { stageCount: 3, avgGroupPercent: 70.0 },
          constrained: { stageCount: 2, avgGroupPercent: 80.0 },
        }),
      }),
    );
    expect(prompt).toContain("+10.0%");
  });
});

describe("first-stage delta line", () => {
  it("omits first-stage line when delta is null", () => {
    const prompt = buildCoachingPrompt(makeInput({ firstStageDelta: null }));
    expect(prompt).not.toContain("Stage 1 vs match average");
  });

  it("omits first-stage line when |delta| < 5", () => {
    const prompt = buildCoachingPrompt(makeInput({ firstStageDelta: -3.0 }));
    expect(prompt).not.toContain("Stage 1 vs match average");
  });

  it("includes first-stage line with 'possible first-stage nerves' when delta <= -10", () => {
    const prompt = buildCoachingPrompt(makeInput({ firstStageDelta: -15.0 }));
    expect(prompt).toContain("Stage 1 vs match average: -15.0% — possible first-stage nerves");
  });

  it("includes first-stage line with 'slightly below' when delta is -5 to -10", () => {
    const prompt = buildCoachingPrompt(makeInput({ firstStageDelta: -7.0 }));
    expect(prompt).toContain("Stage 1 vs match average: -7.0% — slightly below average start");
  });

  it("includes first-stage line with 'strong opener' when delta is positive", () => {
    const prompt = buildCoachingPrompt(makeInput({ firstStageDelta: 12.0 }));
    expect(prompt).toContain("Stage 1 vs match average: +12.0% — strong opener");
  });
});

describe("shooting order context line", () => {
  it("omits shooting order line when stageDegradationData is null", () => {
    const prompt = buildCoachingPrompt(makeInput({ stageDegradationData: null }));
    expect(prompt).not.toContain("Shooting order:");
  });

  it("omits shooting order line when competitor shot early (avg <= 50%)", () => {
    // shooting_order = 5, field_competitor_count = 50 → 10% (early)
    const stage = {
      ...makeStage(1, makeSummary({ shooting_order: 5 })),
      field_competitor_count: 50,
    };
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [stage],
        stageDegradationData: [makeStageDegradation({ spearmanSignificant: true, spearmanR: -0.8 })],
      }),
    );
    expect(prompt).not.toContain("Shooting order:");
  });

  it("omits shooting order line when no significant degradation stages", () => {
    const stage = {
      ...makeStage(1, makeSummary({ shooting_order: 20 })),
      field_competitor_count: 25,
    };
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [stage],
        stageDegradationData: [
          makeStageDegradation({ spearmanSignificant: false, spearmanR: -0.3 }),
        ],
      }),
    );
    expect(prompt).not.toContain("Shooting order:");
  });

  it("includes shooting order line when competitor shot late AND significant degradation exists", () => {
    // shooting_order = 18, field = 20 → 90% (late)
    const stage = {
      ...makeStage(1, makeSummary({ shooting_order: 18 })),
      field_competitor_count: 20,
    };
    const prompt = buildCoachingPrompt(
      makeInput({
        stages: [stage],
        stageDegradationData: [
          makeStageDegradation({ spearmanSignificant: true, spearmanR: -0.75 }),
        ],
      }),
    );
    expect(prompt).toContain("Shooting order:");
    expect(prompt).toContain("late in the field");
    expect(prompt).toContain("degradation correlation on 1 stage");
  });
});

describe("session timing line", () => {
  it("omits session line when both timeOfDayLabel and sessionDurationHours are null", () => {
    const prompt = buildCoachingPrompt(makeInput());
    expect(prompt).not.toContain("Match timing:");
  });

  it("includes only time-of-day when sessionDurationHours is null", () => {
    const prompt = buildCoachingPrompt(
      makeInput({ timeOfDayLabel: "morning", sessionDurationHours: null }),
    );
    expect(prompt).toContain("Match timing: morning");
    expect(prompt).not.toContain("range day");
  });

  it("includes only session duration when timeOfDayLabel is null", () => {
    const prompt = buildCoachingPrompt(
      makeInput({ timeOfDayLabel: null, sessionDurationHours: 5.2 }),
    );
    expect(prompt).toContain("Match timing: 5.2h range day");
  });

  it("includes both fields when both are set", () => {
    const prompt = buildCoachingPrompt(
      makeInput({ timeOfDayLabel: "afternoon", sessionDurationHours: 6.1 }),
    );
    expect(prompt).toContain("Match timing: afternoon, 6.1h range day");
  });
});

// ── formatWeatherBlock + weather context in prompt ────────────────────────────

function makeWeather(overrides?: Partial<MatchWeatherData>): MatchWeatherData {
  return {
    elevation: 82,
    date: "2026-06-15",
    tempRange: [12, 17],
    apparentTempRange: [9, 14],
    humidityAvg: 78,
    windspeedAvg: 7.0,
    windgustMax: 13.0,
    winddirectionDominant: "SW",
    precipitationTotal: 0,
    cloudcoverAvg: 40,
    solarRadiationAvg: 120,
    weatherCode: 2,
    weatherLabel: "partly cloudy",
    wetbulbMax: 11.2,
    snowDepthMax: null,
    visibilityMin: 20_000,
    sunrise: "04:38",
    sunset: "22:02",
    precipitationDayTotal: 0,
    ...overrides,
  };
}

describe("formatWeatherBlock", () => {
  it("includes date and elevation in header", () => {
    const block = formatWeatherBlock(makeWeather());
    expect(block).toContain("2026-06-15");
    expect(block).toContain("82 m elevation");
  });

  it("includes weather label and no-precipitation note", () => {
    const block = formatWeatherBlock(makeWeather());
    expect(block).toContain("partly cloudy");
    expect(block).toContain("no precipitation");
  });

  it("reports precipitation when present during match hours", () => {
    const block = formatWeatherBlock(makeWeather({ precipitationTotal: 3.2 }));
    expect(block).toContain("3.2 mm during match hours");
  });

  it("reports full-day precipitation when no match-hour rain but day total > 0", () => {
    const block = formatWeatherBlock(
      makeWeather({ precipitationTotal: 0, precipitationDayTotal: 5.0 }),
    );
    expect(block).toContain("5.0 mm total on the day");
  });

  it("includes temperature range and feels-like", () => {
    const block = formatWeatherBlock(makeWeather());
    expect(block).toContain("12–17°C");
    expect(block).toContain("feels-like 9–14°C");
    expect(block).toContain("humidity 78%");
  });

  it("includes wind speed, gust, and direction", () => {
    const block = formatWeatherBlock(makeWeather());
    expect(block).toContain("7.0 m/s avg");
    expect(block).toContain("gusting 13.0 m/s");
    expect(block).toContain("from SW");
  });

  it("includes sunrise and sunset times", () => {
    const block = formatWeatherBlock(makeWeather());
    expect(block).toContain("sunrise 04:38");
    expect(block).toContain("sunset 22:02");
  });

  it("includes solar radiation with low/no direct sun note when low", () => {
    const block = formatWeatherBlock(makeWeather({ solarRadiationAvg: 80 }));
    expect(block).toContain("low/no direct sun");
  });

  it("includes strong sun glare warning when radiation > 400", () => {
    const block = formatWeatherBlock(makeWeather({ solarRadiationAvg: 500 }));
    expect(block).toContain("glare risk");
  });

  it("omits visibility line when visibility >= 10 km", () => {
    const block = formatWeatherBlock(makeWeather({ visibilityMin: 20_000 }));
    expect(block).not.toContain("Visibility");
    expect(block).not.toContain("reduced");
  });

  it("includes reduced visibility line when < 10 km", () => {
    const block = formatWeatherBlock(makeWeather({ visibilityMin: 3_000 }));
    expect(block).toContain("3.0 km (reduced)");
  });

  it("includes snow depth when present (converts m to cm)", () => {
    const block = formatWeatherBlock(makeWeather({ snowDepthMax: 0.15 }));
    expect(block).toContain("Snow depth: 15 cm");
  });

  it("omits snow line when snowDepthMax is null or 0", () => {
    const block = formatWeatherBlock(makeWeather({ snowDepthMax: null }));
    expect(block).not.toContain("Snow depth");
  });

  it("flags heat stress when wetbulbMax > 28", () => {
    const block = formatWeatherBlock(makeWeather({ wetbulbMax: 29.5 }));
    expect(block).toContain("heat stress risk");
  });

  it("does not flag heat stress when wetbulbMax <= 28", () => {
    const block = formatWeatherBlock(makeWeather({ wetbulbMax: 22.0 }));
    expect(block).not.toContain("heat stress");
  });
});

describe("weather context in buildCoachingPrompt", () => {
  it("includes weather block when weatherContext is provided", () => {
    const prompt = buildCoachingPrompt(makeInput({ weatherContext: makeWeather() }));
    expect(prompt).toContain("Match-day conditions");
    expect(prompt).toContain("2026-06-15");
    expect(prompt).toContain("partly cloudy");
  });

  it("omits weather block when weatherContext is null", () => {
    const prompt = buildCoachingPrompt(makeInput({ weatherContext: null }));
    expect(prompt).not.toContain("Match-day conditions");
  });

  it("weather block appears in roast prompt too", () => {
    const prompt = buildRoastPrompt(makeInput({ weatherContext: makeWeather() }));
    expect(prompt).toContain("Match-day conditions");
  });
});

// ── buildRoastPrompt tests ─────────────────────────────────────────────────────

describe("buildRoastPrompt", () => {
  it("includes the same context header as coaching prompt", () => {
    const prompt = buildRoastPrompt(makeInput());
    expect(prompt).toContain("John Doe (Production)");
    expect(prompt).toContain("Match: Test Cup 2026");
    expect(prompt).toContain("2.0 per 100 rounds");
  });

  it("includes stage breakdown with difficulty and course size", () => {
    const prompt = buildRoastPrompt(makeInput());
    expect(prompt).toContain("[hard, medium course]");
    expect(prompt).toContain("HF 4.00");
  });

  it("includes roast-specific instruction block", () => {
    const prompt = buildRoastPrompt(makeInput());
    expect(prompt).toContain("roasting");
    expect(prompt).toContain("friendly, humorous");
    expect(prompt).toContain("make them laugh");
    expect(prompt).toContain("Do not include the competitor's name");
  });

  it("does not include professional coach framing", () => {
    const prompt = buildRoastPrompt(makeInput());
    expect(prompt).not.toContain("professional IPSC coach");
  });
});

// ── checkCoachingEligibility tests ─────────────────────────────────────────────

describe("checkCoachingEligibility", () => {
  const competitorId = 100;

  function stagesWithCompetitor(): StageComparison[] {
    return [
      makeStage(1, makeSummary(), competitorId),
      makeStage(2, makeSummary(), competitorId),
    ];
  }

  it("returns null for eligible competitor in complete match (scoring >= 95)", () => {
    expect(
      checkCoachingEligibility(95, 1, stagesWithCompetitor(), competitorId),
    ).toBeNull();
  });

  it("returns null for eligible competitor in complete match (daysSince > 3)", () => {
    expect(
      checkCoachingEligibility(50, 4, stagesWithCompetitor(), competitorId),
    ).toBeNull();
  });

  it("rejects incomplete match (scoring < 95 and daysSince <= 3)", () => {
    const result = checkCoachingEligibility(
      80,
      2,
      stagesWithCompetitor(),
      competitorId,
    );
    expect(result).toBe("Match scoring is not yet complete");
  });

  it("rejects competitor with missing stage scorecards", () => {
    const stages = [
      makeStage(1, makeSummary(), competitorId),
      makeStage(2, null, competitorId), // no scorecard
    ];
    const result = checkCoachingEligibility(100, 5, stages, competitorId);
    expect(result).toBe("Missing scorecards on some stages");
  });

  it("accepts DQ'd competitor (DQ does not block coaching)", () => {
    const stages = [
      makeStage(1, makeSummary({ dq: true }), competitorId),
      makeStage(2, makeSummary(), competitorId),
    ];
    expect(
      checkCoachingEligibility(100, 5, stages, competitorId),
    ).toBeNull();
  });

  it("accepts match at exactly 95% scoring once a day has passed", () => {
    expect(
      checkCoachingEligibility(95, 1, stagesWithCompetitor(), competitorId),
    ).toBeNull();
  });

  it("rejects 95%+ scoring while match is still on the first day", () => {
    // Regression: during an active match day the scoring_completed can
    // climb past 95% before all scorecards are in — coaching should wait.
    expect(
      checkCoachingEligibility(98, 0.5, stagesWithCompetitor(), competitorId),
    ).toBe("Match scoring is not yet complete");
  });

  it("accepts match at boundary daysSince = 3.1", () => {
    expect(
      checkCoachingEligibility(0, 3.1, stagesWithCompetitor(), competitorId),
    ).toBeNull();
  });

  it("rejects at boundary daysSince = 3.0 with low scoring", () => {
    const result = checkCoachingEligibility(
      50,
      3.0,
      stagesWithCompetitor(),
      competitorId,
    );
    expect(result).toBe("Match scoring is not yet complete");
  });
});
