import { describe, it, expect, vi } from "vitest";
import {
  computeResults,
  computeAwards,
  formatResultsTable,
  formatAwards,
  type Prediction,
  type ActualResult,
} from "../src/predict-logic";
import { handlePredict, predictKey } from "../src/commands/predict";
import type { ScoreboardClient } from "../src/scoreboard-client";

// --- Pure logic tests ---

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    discordUserId: "user-1",
    shooterId: 42,
    shooterName: "Jane Doe",
    predictedPct: 72,
    predictedMikes: 5,
    submittedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeResults", () => {
  it("computes diffs for a single prediction", () => {
    const predictions = {
      "user-1": makePrediction({ predictedPct: 72, predictedMikes: 5 }),
    };
    const actualData = {
      "user-1": { matchPctActual: 74.3, totalMisses: 3 },
    };

    const results = computeResults(predictions, actualData);

    expect(results).toHaveLength(1);
    expect(results[0].pctDiff).toBeCloseTo(2.3);
    expect(results[0].mikesDiff).toBe(-2);
  });

  it("sorts by smallest absolute pctDiff", () => {
    const predictions = {
      "user-1": makePrediction({
        discordUserId: "user-1",
        shooterName: "Jane",
        predictedPct: 72,
      }),
      "user-2": makePrediction({
        discordUserId: "user-2",
        shooterName: "John",
        predictedPct: 80,
      }),
      "user-3": makePrediction({
        discordUserId: "user-3",
        shooterName: "Bob",
        predictedPct: 65,
      }),
    };
    const actualData = {
      "user-1": { matchPctActual: 74.3, totalMisses: 3 },
      "user-2": { matchPctActual: 68.1, totalMisses: 8 },
      "user-3": { matchPctActual: 71.2, totalMisses: 4 },
    };

    const results = computeResults(predictions, actualData);

    // user-1: |2.3| = 2.3, user-3: |6.2| = 6.2, user-2: |-11.9| = 11.9
    expect(results[0].shooterName).toBe("Jane");
    expect(results[1].shooterName).toBe("Bob");
    expect(results[2].shooterName).toBe("John");
  });

  it("skips users without actual data", () => {
    const predictions = {
      "user-1": makePrediction(),
      "user-2": makePrediction({ discordUserId: "user-2" }),
    };
    const actualData = {
      "user-1": { matchPctActual: 74.3, totalMisses: 3 },
      // user-2 not in actual data (maybe DQ'd or didn't shoot)
    };

    const results = computeResults(predictions, actualData);
    expect(results).toHaveLength(1);
  });
});

describe("computeAwards", () => {
  it("returns all nulls for empty results", () => {
    const awards = computeAwards([]);
    expect(awards.mostAccurate).toBeNull();
    expect(awards.mostHumble).toBeNull();
    expect(awards.mostOverconfident).toBeNull();
    expect(awards.oracle).toBeNull();
    expect(awards.mikeOracle).toBeNull();
    expect(awards.mikePessimist).toBeNull();
  });

  it("identifies oracle (within 1%)", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Jane",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 72.5,
        actualMikes: 3,
        pctDiff: 0.5,
        mikesDiff: -2,
      },
    ];

    const awards = computeAwards(results);
    expect(awards.oracle).toBeDefined();
    expect(awards.oracle!.shooterName).toBe("Jane");
  });

  it("identifies mike oracle (exact mikes)", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Jane",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 80,
        actualMikes: 5,
        pctDiff: 8,
        mikesDiff: 0,
      },
    ];

    const awards = computeAwards(results);
    expect(awards.mikeOracle).toBeDefined();
    expect(awards.mikeOracle!.shooterName).toBe("Jane");
  });

  it("identifies most humble (actual >> predicted)", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Humble Joe",
        predictedPct: 60,
        predictedMikes: 10,
        actualPct: 78,
        actualMikes: 3,
        pctDiff: 18,
        mikesDiff: -7,
      },
      {
        discordUserId: "user-2",
        shooterName: "Accurate Jane",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 72.5,
        actualMikes: 5,
        pctDiff: 0.5,
        mikesDiff: 0,
      },
    ];

    // Sort by abs diff (Accurate Jane first)
    results.sort((a, b) => Math.abs(a.pctDiff) - Math.abs(b.pctDiff));

    const awards = computeAwards(results);
    expect(awards.mostAccurate!.shooterName).toBe("Accurate Jane");
    expect(awards.mostHumble!.shooterName).toBe("Humble Joe");
  });

  it("identifies most overconfident (actual << predicted)", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Overconfident Bob",
        predictedPct: 85,
        predictedMikes: 2,
        actualPct: 65,
        actualMikes: 12,
        pctDiff: -20,
        mikesDiff: 10,
      },
      {
        discordUserId: "user-2",
        shooterName: "Accurate Jane",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 73,
        actualMikes: 5,
        pctDiff: 1,
        mikesDiff: 0,
      },
    ];

    results.sort((a, b) => Math.abs(a.pctDiff) - Math.abs(b.pctDiff));

    const awards = computeAwards(results);
    expect(awards.mostAccurate!.shooterName).toBe("Accurate Jane");
    expect(awards.mostOverconfident!.shooterName).toBe("Overconfident Bob");
  });

  it("identifies mike pessimist (predicted many more mikes than actual)", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Pessimist Pete",
        predictedPct: 70,
        predictedMikes: 15,
        actualPct: 72,
        actualMikes: 3,
        pctDiff: 2,
        mikesDiff: -12,
      },
    ];

    const awards = computeAwards(results);
    expect(awards.mikePessimist!.shooterName).toBe("Pessimist Pete");
  });

  it("does not award humble/overconfident for small diffs", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Jane",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 72.5,
        actualMikes: 5,
        pctDiff: 0.5,
        mikesDiff: 0,
      },
    ];

    const awards = computeAwards(results);
    expect(awards.mostHumble).toBeNull();
    expect(awards.mostOverconfident).toBeNull();
  });
});

describe("formatResultsTable", () => {
  it("returns no-match message for empty results", () => {
    expect(formatResultsTable([])).toContain("No predictions matched");
  });

  it("formats a table with results", () => {
    const results: ActualResult[] = [
      {
        discordUserId: "user-1",
        shooterName: "Jane Doe",
        predictedPct: 72,
        predictedMikes: 5,
        actualPct: 74.3,
        actualMikes: 3,
        pctDiff: 2.3,
        mikesDiff: -2,
      },
    ];

    const table = formatResultsTable(results);
    expect(table).toContain("```");
    expect(table).toContain("Jane Doe");
    expect(table).toContain("72.0%");
    expect(table).toContain("74.3%");
    expect(table).toContain("+2.3%");
  });
});

describe("formatAwards", () => {
  it("shows oracle award", () => {
    const result: ActualResult = {
      discordUserId: "user-1",
      shooterName: "Jane",
      predictedPct: 72,
      predictedMikes: 5,
      actualPct: 72.5,
      actualMikes: 5,
      pctDiff: 0.5,
      mikesDiff: 0,
    };

    const text = formatAwards({
      mostAccurate: result,
      mostHumble: null,
      mostOverconfident: null,
      oracle: result,
      mikeOracle: result,
      mikePessimist: null,
    });

    expect(text).toContain("Oracle");
    expect(text).toContain("Mike Oracle");
    expect(text).toContain("Most Accurate");
  });
});

// --- Command handler tests ---

function mockClient(overrides: Partial<ScoreboardClient> = {}): ScoreboardClient {
  return {
    searchEvents: vi.fn().mockResolvedValue([]),
    getMatch: vi.fn().mockResolvedValue({}),
    searchShooters: vi.fn().mockResolvedValue([]),
    getShooterDashboard: vi.fn().mockResolvedValue({}),
    compare: vi.fn().mockResolvedValue({ stages: [], competitors: [] }),
    compareWithPenaltyStats: vi.fn().mockResolvedValue({
      stages: [],
      competitors: [],
      penaltyStats: {},
    }),
    ...overrides,
  } as unknown as ScoreboardClient;
}

function mockKV(store: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn((key: string) => Promise.resolve(store[key] ?? null)),
    put: vi.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    list: vi.fn(({ prefix }: { prefix: string }) =>
      Promise.resolve({
        keys: Object.keys(store)
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name })),
      }),
    ),
  } as unknown as KVNamespace;
}

const BASE_URL = "https://scoreboard.urdr.dev";

describe("handlePredict — submit", () => {
  it("stores a prediction for a linked shooter in the match", async () => {
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([
        { id: 100, content_type: 22, name: "Swedish Handgun 2026" },
      ]),
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        date: "2026-06-15",
        scoring_completed: 0,
        competitors: [
          { id: 1, shooterId: 42, name: "Jane Doe" },
        ],
        stages: [],
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "submit", "Swedish", 72, 5,
    );

    expect(result.content).toContain("Locked in");
    expect(result.content).toContain("72%");
    expect(result.content).toContain("5");
    expect(kv.put).toHaveBeenCalledWith(
      "g:guild-1:predict:22:100",
      expect.stringContaining('"predictedPct":72'),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });

  it("rejects when match has started scoring", async () => {
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([
        { id: 100, content_type: 22, name: "Swedish Handgun 2026" },
      ]),
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        scoring_completed: 30,
        competitors: [],
        stages: [],
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "submit", "Swedish", 72, 5,
    );

    expect(result.content).toContain("predictions are locked");
  });

  it("rejects when user is not linked", async () => {
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([
        { id: 100, content_type: 22, name: "Swedish Handgun 2026" },
      ]),
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        scoring_completed: 0,
        competitors: [],
        stages: [],
      }),
    });

    const kv = mockKV();

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "submit", "Swedish", 72, 5,
    );

    expect(result.content).toContain("link your account");
  });

  it("rejects when user is not a competitor in the match", async () => {
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([
        { id: 100, content_type: 22, name: "Swedish Handgun 2026" },
      ]),
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        scoring_completed: 0,
        competitors: [
          { id: 1, shooterId: 999, name: "Other Person" },
        ],
        stages: [],
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "submit", "Swedish", 72, 5,
    );

    expect(result.content).toContain("not registered as a competitor");
  });

  it("allows updating an existing prediction", async () => {
    const client = mockClient({
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        date: "2026-06-15",
        scoring_completed: 0,
        competitors: [
          { id: 1, shooterId: 42, name: "Jane Doe" },
        ],
        stages: [],
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
      "g:guild-1:predict:22:100": JSON.stringify({
        matchCt: 22,
        matchId: 100,
        matchName: "Swedish Handgun 2026",
        matchDate: "2026-06-15",
        predictions: {
          "user-1": {
            discordUserId: "user-1",
            shooterId: 42,
            shooterName: "Jane Doe",
            predictedPct: 70,
            predictedMikes: 3,
            submittedAt: "2026-01-01T00:00:00Z",
          },
        },
        revealed: false,
      }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "submit", "22:100", 75, 4,
    );

    expect(result.content).toContain("Updated");
    expect(result.content).toContain("75%");
  });
});

describe("handlePredict — reveal", () => {
  it("reveals predictions when match is sufficiently scored", async () => {
    const client = mockClient({
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        scoring_completed: 100,
        competitors: [
          { id: 1, shooterId: 42, name: "Jane Doe" },
        ],
        stages: [],
      }),
      compareWithPenaltyStats: vi.fn().mockResolvedValue({
        stages: [
          {
            stage_id: 1,
            stage_name: "Stage 1",
            stage_num: 1,
            max_points: 150,
            overall_leader_hf: 8.0,
            competitors: {
              1: { competitor_id: 1, miss_count: 2, hit_factor: 5.0 },
            },
          },
          {
            stage_id: 2,
            stage_name: "Stage 2",
            stage_num: 2,
            max_points: 120,
            overall_leader_hf: 7.0,
            competitors: {
              1: { competitor_id: 1, miss_count: 1, hit_factor: 6.0 },
            },
          },
        ],
        competitors: [{ id: 1, name: "Jane Doe" }],
        penaltyStats: {
          1: { matchPctActual: 74.3, totalPenalties: 3, penaltyCostPercent: 2.5, matchPctClean: 76.8, penaltiesPerStage: 1.5, penaltiesPer100Rounds: 5.0 },
        },
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:predict:22:100": JSON.stringify({
        matchCt: 22,
        matchId: 100,
        matchName: "Swedish Handgun 2026",
        matchDate: "2026-06-15",
        predictions: {
          "user-1": {
            discordUserId: "user-1",
            shooterId: 42,
            shooterName: "Jane Doe",
            predictedPct: 72,
            predictedMikes: 5,
            submittedAt: "2026-01-01T00:00:00Z",
          },
        },
        revealed: false,
      }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "reveal", "22:100", undefined, undefined,
    );

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toContain("Prediction Results");
    expect(result.embeds[0].description).toContain("Jane Doe");
    expect(result.embeds[0].description).toContain("74.3%");

    // Check state was marked as revealed
    const savedState = JSON.parse(store["g:guild-1:predict:22:100"]);
    expect(savedState.revealed).toBe(true);
  });

  it("rejects reveal when match is not sufficiently scored", async () => {
    const client = mockClient({
      getMatch: vi.fn().mockResolvedValue({
        name: "Swedish Handgun 2026",
        scoring_completed: 50,
        competitors: [],
        stages: [],
      }),
    });

    const store: Record<string, string> = {
      "g:guild-1:predict:22:100": JSON.stringify({
        matchCt: 22,
        matchId: 100,
        matchName: "Swedish Handgun 2026",
        matchDate: "2026-06-15",
        predictions: {
          "user-1": makePrediction(),
        },
        revealed: false,
      }),
    };
    const kv = mockKV(store);

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "reveal", "22:100", undefined, undefined,
    );

    expect(result.content).toContain("50% scored");
    expect(result.content).toContain("95%+");
  });
});

describe("handlePredict — status", () => {
  it("lists active predictions in guild", async () => {
    const store: Record<string, string> = {
      "g:guild-1:predict:22:100": JSON.stringify({
        matchCt: 22,
        matchId: 100,
        matchName: "Swedish Handgun 2026",
        predictions: { "user-1": makePrediction() },
        revealed: false,
      }),
    };
    const kv = mockKV(store);
    const client = mockClient();

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "status", undefined, undefined, undefined,
    );

    expect(result.content).toContain("Swedish Handgun 2026");
    expect(result.content).toContain("1 prediction");
  });

  it("shows empty message when no predictions", async () => {
    const kv = mockKV();
    const client = mockClient();

    const result = await handlePredict(
      client, kv, BASE_URL, "guild-1", "user-1",
      "status", undefined, undefined, undefined,
    );

    expect(result.content).toContain("No active prediction games");
  });
});

describe("predictKey", () => {
  it("is guild and match scoped", () => {
    expect(predictKey("guild-1", 22, 100)).toBe("g:guild-1:predict:22:100");
  });
});
