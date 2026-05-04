import { describe, it, expect } from "vitest";
import {
  parseCompetitorScorecards,
  type CompetitorScorecardsData,
} from "@/lib/scorecards-per-competitor";

function makeScorecard(overrides: Partial<{
  stageId: string;
  stageNumber: number;
  stageName: string;
  maxPoints: number;
  competitorId: string;
  division: string | null;
  points: number | string | null;
  hitfactor: number | string | null;
  time: number | string | null;
  ascore: number | string | null;
  bscore: number | string | null;
  cscore: number | string | null;
  dscore: number | string | null;
  miss: number | string | null;
  penalty: number | string | null;
  procedural: number | string | null;
  disqualified: boolean | null;
  zeroed: boolean | null;
  stage_not_fired: boolean | null;
  incomplete: boolean | null;
  created: string | null;
}>): CompetitorScorecardsData["competitor_scorecards"][number] {
  return {
    stage: {
      id: overrides.stageId ?? "100",
      number: overrides.stageNumber ?? 1,
      name: overrides.stageName ?? "Stage 1",
      max_points: overrides.maxPoints ?? 60,
    },
    created: overrides.created ?? "2026-05-01T10:00:00Z",
    points: overrides.points ?? 50,
    hitfactor: overrides.hitfactor ?? 5.5,
    time: overrides.time ?? 9.1,
    disqualified: overrides.disqualified ?? false,
    zeroed: overrides.zeroed ?? false,
    stage_not_fired: overrides.stage_not_fired ?? false,
    incomplete: overrides.incomplete ?? false,
    ascore: overrides.ascore ?? 8,
    bscore: overrides.bscore ?? 0,
    cscore: overrides.cscore ?? 2,
    dscore: overrides.dscore ?? 0,
    miss: overrides.miss ?? 0,
    penalty: overrides.penalty ?? 0,
    procedural: overrides.procedural ?? 0,
    competitor: {
      id: overrides.competitorId ?? "777",
      get_division_display: overrides.division ?? "Production",
    },
  };
}

describe("parseCompetitorScorecards", () => {
  it("emits one RawScorecard per matching scorecard", () => {
    const data: CompetitorScorecardsData = {
      competitor_scorecards: [
        makeScorecard({ stageId: "100", competitorId: "777" }),
        makeScorecard({ stageId: "101", competitorId: "777", stageNumber: 2 }),
      ],
    };
    const out = parseCompetitorScorecards(data, 777, new Set([100, 101]));
    expect(out).toHaveLength(2);
    expect(out[0].competitor_id).toBe(777);
    expect(out[0].stage_id).toBe(100);
    expect(out[1].stage_id).toBe(101);
  });

  it("filters out scorecards from stages outside the requested match", () => {
    const data: CompetitorScorecardsData = {
      competitor_scorecards: [
        makeScorecard({ stageId: "100", competitorId: "777" }),
        // Stage 999 belongs to a different match the shooter also competed in
        makeScorecard({ stageId: "999", competitorId: "777", stageNumber: 5 }),
      ],
    };
    const out = parseCompetitorScorecards(data, 777, new Set([100]));
    expect(out).toHaveLength(1);
    expect(out[0].stage_id).toBe(100);
  });

  it("filters out scorecards belonging to a different competitor", () => {
    // SSI's response should be scoped to the queried competitor, but the
    // parser defends against malformed responses (e.g. someone passing the
    // wrong competitor id).
    const data: CompetitorScorecardsData = {
      competitor_scorecards: [
        makeScorecard({ competitorId: "888" }),
        makeScorecard({ competitorId: "777" }),
      ],
    };
    const out = parseCompetitorScorecards(data, 777, new Set([100]));
    expect(out).toHaveLength(1);
    expect(out[0].competitor_id).toBe(777);
  });

  it("drops scorecards with no stage or no competitor reference", () => {
    const data = {
      competitor_scorecards: [
        { ...makeScorecard({}), stage: null },
        { ...makeScorecard({}), competitor: null },
      ],
    } as CompetitorScorecardsData;
    const out = parseCompetitorScorecards(data, 777, new Set([100]));
    expect(out).toHaveLength(0);
  });

  it("combines b-zone hits into c_hits", () => {
    const data: CompetitorScorecardsData = {
      competitor_scorecards: [
        makeScorecard({ ascore: 8, bscore: 2, cscore: 4, dscore: 1 }),
      ],
    };
    const out = parseCompetitorScorecards(data, 777, new Set([100]));
    expect(out[0].a_hits).toBe(8);
    expect(out[0].c_hits).toBe(6); // b + c
    expect(out[0].d_hits).toBe(1);
  });

  it("preserves null hit zones when both b and c are null", () => {
    const data = {
      competitor_scorecards: [
        { ...makeScorecard({}), bscore: null, cscore: null },
      ],
    } as CompetitorScorecardsData;
    const out = parseCompetitorScorecards(data, 777, new Set([100]));
    expect(out[0].c_hits).toBeNull();
  });

  it("forwards DQ and DNF flags as-is", () => {
    const data: CompetitorScorecardsData = {
      competitor_scorecards: [
        makeScorecard({ stageId: "100", disqualified: true }),
        makeScorecard({ stageId: "101", stageNumber: 2, stage_not_fired: true }),
      ],
    };
    const out = parseCompetitorScorecards(data, 777, new Set([100, 101]));
    expect(out[0].dq).toBe(true);
    expect(out[1].dnf).toBe(true);
  });

  it("returns an empty array for an empty response", () => {
    const out = parseCompetitorScorecards(
      { competitor_scorecards: [] },
      777,
      new Set([100]),
    );
    expect(out).toEqual([]);
  });
});
