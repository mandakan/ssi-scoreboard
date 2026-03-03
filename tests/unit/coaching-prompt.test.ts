import { describe, it, expect } from "vitest";
import {
  buildCoachingPrompt,
  buildRoastPrompt,
  checkCoachingEligibility,
  type CoachingPromptInput,
} from "@/lib/coaching-prompt";
import type {
  CompetitorInfo,
  StageComparison,
  CompetitorPenaltyStats,
  ConsistencyStats,
  StyleFingerprintStats,
  CompetitorSummary,
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

  it("accepts match at exactly 95% scoring", () => {
    expect(
      checkCoachingEligibility(95, 0, stagesWithCompetitor(), competitorId),
    ).toBeNull();
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
