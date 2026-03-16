import { describe, it, expect } from "vitest";
import { buildSummaryEmbed } from "../src/commands/summary";
import type { CompetitorStageResult } from "../src/types";

function makeResult(overrides: Partial<CompetitorStageResult> = {}): CompetitorStageResult {
  return {
    competitor_id: 1,
    hit_factor: 5.1234,
    points: 120,
    time: 23.53,
    overall_rank: 12,
    overall_percent: 75.2,
    a_hits: 20,
    c_hits: 2,
    d_hits: 1,
    miss_count: 0,
    dnf: false,
    dq: false,
    incomplete: false,
    ...overrides,
  };
}

describe("buildSummaryEmbed", () => {
  it("builds an embed with stage table for scored stages", () => {
    const embed = buildSummaryEmbed(
      {
        name: "Jane Doe",
        division: "Production",
        club: "Gothenburg PSK",
        competitorId: 42,
        stages: [
          { stageNum: 1, stageName: "Speed", result: makeResult({ hit_factor: 6.5 }) },
          { stageNum: 2, stageName: "Accuracy", result: makeResult({ hit_factor: 4.2 }) },
        ],
        overallRank: null,
        avgPercent: 75.2,
      },
      "Swedish Handgun",
      "75% scored",
      "https://scoreboard.urdr.dev/match/22/100",
    );

    expect(embed.title).toBe("Jane Doe");
    const fieldNames = embed.fields!.map((f) => f.name);
    expect(fieldNames).toContain("Info");
    expect(fieldNames).toContain("Avg %");
    expect(fieldNames).toContain("Stage Results");

    const stageField = embed.fields!.find((f) => f.name === "Stage Results");
    expect(stageField!.value).toContain("```");
    expect(stageField!.value).toContain("S01");
    expect(stageField!.value).toContain("S02");
  });

  it("shows pending count for unscored stages", () => {
    const embed = buildSummaryEmbed(
      {
        name: "Jane Doe",
        division: "Production",
        club: "",
        competitorId: 42,
        stages: [
          { stageNum: 1, stageName: "Speed", result: makeResult() },
          { stageNum: 2, stageName: "Accuracy", result: makeResult({ hit_factor: null, incomplete: true }) },
        ],
        overallRank: null,
        avgPercent: 75.2,
      },
      "Match",
      "50% scored",
      "https://example.com",
    );

    const pendingField = embed.fields!.find((f) => f.name === "Pending");
    expect(pendingField).toBeDefined();
    expect(pendingField!.value).toContain("1 stage not yet scored");
  });

  it("uses color based on avg percent", () => {
    const make = (pct: number) =>
      buildSummaryEmbed(
        {
          name: "X",
          division: "",
          club: "",
          competitorId: 1,
          stages: [],
          overallRank: null,
          avgPercent: pct,
        },
        "M",
        "done",
        "https://example.com",
      );

    expect(make(95).color).toBe(0x22c55e); // green
    expect(make(75).color).toBe(0x3b82f6); // blue
    expect(make(55).color).toBe(0xf59e0b); // amber
    expect(make(30).color).toBe(0xef4444); // red
  });
});
