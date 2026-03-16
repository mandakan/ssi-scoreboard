import { describe, it, expect, vi } from "vitest";
import { handleWatch, handleUnwatch, watchKey } from "../src/commands/watch";
import { buildStageGroupEmbed, isMatchDone } from "../src/notifications/stage-scored";
import type { ScoreboardClient } from "../src/scoreboard-client";
import type { EventSearchResult, CompetitorStageResult } from "../src/types";

function mockClient(overrides: Partial<ScoreboardClient> = {}): ScoreboardClient {
  return {
    searchEvents: vi.fn().mockResolvedValue([]),
    getMatch: vi.fn().mockResolvedValue({}),
    searchShooters: vi.fn().mockResolvedValue([]),
    getShooterDashboard: vi.fn().mockResolvedValue({}),
    compare: vi.fn().mockResolvedValue({ stages: [], competitors: [] }),
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

function makeEvent(overrides: Partial<EventSearchResult> = {}): EventSearchResult {
  return {
    id: 100,
    content_type: 22,
    name: "Swedish Handgun 2026",
    venue: "Gothenburg",
    date: "2026-06-15",
    level: "Level III",
    status: "on",
    region: "Sweden",
    discipline: "IPSC Handgun",
    ...overrides,
  };
}

// --- /watch ---

describe("handleWatch", () => {
  it("stores watch state and returns embed with tracked names", async () => {
    const event = makeEvent();
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
      getMatch: vi.fn().mockResolvedValue({
        scoring_completed: 30,
        competitors_count: 120,
        stages_count: 16,
        competitors: [
          { id: 1, shooterId: 42, name: "Jane Doe", division: "Production", club: "PSK" },
        ],
        stages: [],
        squads: [],
      }),
    });
    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "Swedish");

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toContain("Swedish Handgun 2026");
    const trackingField = result.embeds[0].fields!.find((f) => f.name === "Tracking");
    expect(trackingField?.value).toContain("Jane Doe");
    expect(kv.put).toHaveBeenCalledWith(
      "g:guild-1:watch",
      expect.stringContaining('"matchId":100'),
    );
  });

  it("rejects when no linked shooters exist", async () => {
    const event = makeEvent();
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
    });
    const kv = mockKV();

    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "Swedish");
    expect(result.content).toContain("No one in this server has linked");
    expect(result.content).toContain("/link");
    expect(result.embeds).toHaveLength(0);
  });

  it("rejects when linked shooters are not in the match", async () => {
    const event = makeEvent();
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
      getMatch: vi.fn().mockResolvedValue({
        scoring_completed: 30,
        competitors_count: 120,
        stages_count: 16,
        competitors: [
          { id: 1, shooterId: 999, name: "Other Person", division: "Open", club: "ABC" },
        ],
        stages: [],
        squads: [],
      }),
    });
    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "Swedish");
    expect(result.content).toContain("None of the linked shooters");
    expect(result.content).toContain("Jane Doe");
    expect(result.embeds).toHaveLength(0);
  });

  it("rejects when already watching", async () => {
    const store: Record<string, string> = {
      "g:guild-1:watch": JSON.stringify({
        matchCt: 22,
        matchId: 100,
        matchName: "Some Match",
        channelId: "ch-1",
        lastScoringPct: 30,
        notifiedStages: {},
        createdAt: "2026-01-01T00:00:00Z",
      }),
    };
    const kv = mockKV(store);
    const client = mockClient();

    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "Swedish");
    expect(result.content).toContain("Already watching");
    expect(result.embeds).toHaveLength(0);
  });

  it("rejects fully scored matches", async () => {
    const event = makeEvent();
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
      getMatch: vi.fn().mockResolvedValue({
        scoring_completed: 100,
        competitors_count: 120,
        stages_count: 16,
        competitors: [],
        stages: [],
        squads: [],
      }),
    });
    const store: Record<string, string> = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);

    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "Swedish");
    expect(result.content).toContain("already fully scored");
  });

  it("returns no-results message", async () => {
    const client = mockClient();
    const kv = mockKV();
    const result = await handleWatch(client, kv, BASE_URL, "guild-1", "channel-1", "nonexistent");
    expect(result.content).toContain("No matches found");
  });
});

// --- /unwatch ---

describe("handleUnwatch", () => {
  it("deletes watch state", async () => {
    const store: Record<string, string> = {
      "g:guild-1:watch": JSON.stringify({ matchName: "Some Match" }),
    };
    const kv = mockKV(store);

    const msg = await handleUnwatch(kv, "guild-1");
    expect(msg).toContain("Stopped watching");
    expect(kv.delete).toHaveBeenCalledWith("g:guild-1:watch");
  });

  it("returns message when not watching", async () => {
    const kv = mockKV();
    const msg = await handleUnwatch(kv, "guild-1");
    expect(msg).toContain("Not currently watching");
  });
});

// --- watchKey ---

describe("watchKey", () => {
  it("is guild-scoped", () => {
    expect(watchKey("guild-1")).toBe("g:guild-1:watch");
    expect(watchKey("guild-2")).toBe("g:guild-2:watch");
  });
});

// --- buildStageGroupEmbed ---

describe("buildStageGroupEmbed", () => {
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

  it("builds a detailed embed for a single shooter", () => {
    const embed = buildStageGroupEmbed(
      {
        stageId: 1,
        stageName: "Classifier",
        stageNum: 3,
        overallLeaderHf: 7.5,
        scores: [{ competitorName: "Jane Doe", result: makeResult() }],
      },
      "Swedish Handgun",
      "https://scoreboard.urdr.dev/match/22/100",
    );

    expect(embed.title).toBe("Stage 3: Classifier");
    const fieldNames = embed.fields!.map((f) => f.name);
    expect(fieldNames).toContain("Shooter");
    expect(fieldNames).toContain("HF");
    expect(fieldNames).toContain("Time");
    expect(fieldNames).toContain("Stage Rank");
    expect(fieldNames).toContain("Hits");
  });

  it("builds a comparison table for multiple shooters", () => {
    const embed = buildStageGroupEmbed(
      {
        stageId: 1,
        stageName: "Speed Shoot",
        stageNum: 5,
        overallLeaderHf: 8.0,
        scores: [
          { competitorName: "Jane Doe", result: makeResult({ hit_factor: 6.5, overall_rank: 5 }) },
          { competitorName: "John Smith", result: makeResult({ hit_factor: 5.2, overall_rank: 15 }) },
        ],
      },
      "Swedish Handgun",
      "https://scoreboard.urdr.dev/match/22/100",
    );

    expect(embed.title).toBe("Stage 5: Speed Shoot");
    const resultsField = embed.fields!.find((f) => f.name === "Results");
    expect(resultsField).toBeDefined();
    expect(resultsField!.value).toContain("Jane Doe");
    expect(resultsField!.value).toContain("John Smith");
    expect(resultsField!.value).toContain("```"); // code block for table
  });

  it("uses green color for 90%+ results", () => {
    const embed = buildStageGroupEmbed(
      {
        stageId: 1,
        stageName: "Test",
        stageNum: 1,
        overallLeaderHf: 5.0,
        scores: [{ competitorName: "Pro", result: makeResult({ overall_percent: 95 }) }],
      },
      "Match",
      "https://example.com",
    );
    expect(embed.color).toBe(0x22c55e);
  });

  it("uses red color for sub-50% results", () => {
    const embed = buildStageGroupEmbed(
      {
        stageId: 1,
        stageName: "Test",
        stageNum: 1,
        overallLeaderHf: 5.0,
        scores: [{ competitorName: "Beginner", result: makeResult({ overall_percent: 35 }) }],
      },
      "Match",
      "https://example.com",
    );
    expect(embed.color).toBe(0xef4444);
  });
});

// --- isMatchDone ---

describe("isMatchDone", () => {
  it("returns true when scoring >= 95%", () => {
    expect(isMatchDone(95, null)).toBe(true);
    expect(isMatchDone(100, null)).toBe(true);
  });

  it("returns false when scoring < 95% and no date", () => {
    expect(isMatchDone(94, null)).toBe(false);
    expect(isMatchDone(0, null)).toBe(false);
  });

  it("returns true when match date is > 3 days ago", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(isMatchDone(50, fourDaysAgo)).toBe(true);
  });

  it("returns false when match date is recent", () => {
    const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isMatchDone(50, yesterday)).toBe(false);
  });

  it("returns false for future match dates", () => {
    const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isMatchDone(0, tomorrow)).toBe(false);
  });
});
