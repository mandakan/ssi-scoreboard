import { describe, it, expect, vi } from "vitest";
import { handleMatch } from "../src/commands/match";
import { handleShooter } from "../src/commands/shooter";
import { handleLink, getLinkedShooter } from "../src/commands/link";
import { handleHelp, WELCOME_EMBED } from "../src/commands/help";
import type { ScoreboardClient } from "../src/scoreboard-client";
import type {
  EventSearchResult,
  ShooterSearchResult,
  ShooterDashboardResponse,
} from "../src/types";

// --- Mock helpers ---

function mockClient(overrides: Partial<ScoreboardClient> = {}): ScoreboardClient {
  return {
    searchEvents: vi.fn().mockResolvedValue([]),
    getMatch: vi.fn().mockResolvedValue({}),
    searchShooters: vi.fn().mockResolvedValue([]),
    getShooterDashboard: vi.fn().mockResolvedValue({}),
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
  } as unknown as KVNamespace;
}

const BASE_URL = "https://scoreboard.urdr.dev";

function makeEvent(overrides: Partial<EventSearchResult> = {}): EventSearchResult {
  return {
    id: 100,
    content_type: 22,
    name: "Swedish Handgun Championship 2026",
    venue: "Gothenburg",
    date: "2026-06-15",
    level: "Level III",
    scoring_completed: 100,
    competitors_count: 120,
    stages_count: 16,
    ...overrides,
  };
}

function makeShooterResult(overrides: Partial<ShooterSearchResult> = {}): ShooterSearchResult {
  return {
    shooterId: 42,
    name: "Jane Doe",
    club: "Gothenburg PSK",
    division: "Production",
    ...overrides,
  };
}

function makeDashboard(overrides: Partial<ShooterDashboardResponse> = {}): ShooterDashboardResponse {
  return {
    shooterId: 42,
    name: "Jane Doe",
    club: "Gothenburg PSK",
    division: "Production",
    matchCount: 15,
    stageCount: 180,
    avgMatchPercent: 72.5,
    achievements: [],
    recentMatches: [],
    ...overrides,
  };
}

// --- /match ---

describe("handleMatch", () => {
  it("returns no-results message when search is empty", async () => {
    const client = mockClient();
    const result = await handleMatch(client, BASE_URL, "nonexistent");
    expect(result.content).toContain('No matches found for "nonexistent"');
    expect(result.embeds).toHaveLength(0);
  });

  it("returns an embed for a single match result", async () => {
    const event = makeEvent();
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
    });
    const result = await handleMatch(client, BASE_URL, "Swedish");
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toBe(event.name);
    expect(result.embeds[0].url).toBe(`${BASE_URL}/match/22/100`);
    expect(result.content).toBe("");
  });

  it("shows completed status with green color", async () => {
    const event = makeEvent({ scoring_completed: 100 });
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
    });
    const result = await handleMatch(client, BASE_URL, "Swedish");
    const statusField = result.embeds[0].fields?.find((f) => f.name === "Status");
    expect(statusField?.value).toBe("Completed");
    expect(result.embeds[0].color).toBe(0x22c55e);
  });

  it("shows scoring percentage for in-progress matches", async () => {
    const event = makeEvent({ scoring_completed: 45 });
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
    });
    const result = await handleMatch(client, BASE_URL, "Swedish");
    const statusField = result.embeds[0].fields?.find((f) => f.name === "Status");
    expect(statusField?.value).toBe("45% scored");
    expect(result.embeds[0].color).toBe(0x3b82f6);
  });

  it("shows 'Not started' for zero scoring", async () => {
    const event = makeEvent({ scoring_completed: 0 });
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue([event]),
    });
    const result = await handleMatch(client, BASE_URL, "Swedish");
    const statusField = result.embeds[0].fields?.find((f) => f.name === "Status");
    expect(statusField?.value).toBe("Not started");
  });

  it("lists other matches when multiple results found", async () => {
    const events = [
      makeEvent({ id: 1, name: "Match A", date: "2026-01-01" }),
      makeEvent({ id: 2, name: "Match B", date: "2026-02-01" }),
      makeEvent({ id: 3, name: "Match C", date: "2026-03-01" }),
    ];
    const client = mockClient({
      searchEvents: vi.fn().mockResolvedValue(events),
    });
    const result = await handleMatch(client, BASE_URL, "Match");
    expect(result.content).toContain("Found 3 matches");
    expect(result.content).toContain("Match B");
    expect(result.content).toContain("Match C");
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toBe("Match A");
  });
});

// --- /shooter ---

describe("handleShooter", () => {
  it("returns no-results message when search is empty", async () => {
    const client = mockClient();
    const result = await handleShooter(client, BASE_URL, "nobody");
    expect(result.content).toContain('No shooter found matching "nobody"');
    expect(result.embeds).toHaveLength(0);
  });

  it("returns dashboard embed for a found shooter", async () => {
    const shooter = makeShooterResult();
    const dashboard = makeDashboard();
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue([shooter]),
      getShooterDashboard: vi.fn().mockResolvedValue(dashboard),
    });
    const result = await handleShooter(client, BASE_URL, "Jane");
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toBe("Jane Doe");
    expect(result.embeds[0].url).toBe(`${BASE_URL}/shooter/42`);

    const fields = result.embeds[0].fields!;
    expect(fields.find((f) => f.name === "Matches")?.value).toBe("15");
    expect(fields.find((f) => f.name === "Stages")?.value).toBe("180");
    expect(fields.find((f) => f.name === "Avg Match %")?.value).toBe("72.5%");
    expect(fields.find((f) => f.name === "Club")?.value).toBe("Gothenburg PSK");
    expect(fields.find((f) => f.name === "Division")?.value).toBe("Production");
  });

  it("omits avg match % when null", async () => {
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue([makeShooterResult()]),
      getShooterDashboard: vi.fn().mockResolvedValue(makeDashboard({ avgMatchPercent: null })),
    });
    const result = await handleShooter(client, BASE_URL, "Jane");
    const fields = result.embeds[0].fields!;
    expect(fields.find((f) => f.name === "Avg Match %")).toBeUndefined();
  });

  it("shows achievements when present", async () => {
    const dashboard = makeDashboard({
      achievements: [
        { id: "competitor", name: "Competitor", tier: "Bronze", icon: "medal" },
      ],
    });
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue([makeShooterResult()]),
      getShooterDashboard: vi.fn().mockResolvedValue(dashboard),
    });
    const result = await handleShooter(client, BASE_URL, "Jane");
    const achField = result.embeds[0].fields!.find((f) => f.name === "Achievements");
    expect(achField?.value).toContain("Competitor");
    expect(achField?.value).toContain("Bronze");
  });

  it("shows recent matches when present", async () => {
    const dashboard = makeDashboard({
      recentMatches: [
        { name: "Regional Match", date: "2026-03-01", matchPercent: 68.2 },
      ],
    });
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue([makeShooterResult()]),
      getShooterDashboard: vi.fn().mockResolvedValue(dashboard),
    });
    const result = await handleShooter(client, BASE_URL, "Jane");
    const recentField = result.embeds[0].fields!.find((f) => f.name === "Recent Matches");
    expect(recentField?.value).toContain("Regional Match");
    expect(recentField?.value).toContain("68.2%");
  });

  it("lists alternatives when multiple shooters found", async () => {
    const shooters = [
      makeShooterResult({ shooterId: 1, name: "Jane Doe", club: "Club A" }),
      makeShooterResult({ shooterId: 2, name: "Jane Smith", club: "Club B" }),
    ];
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue(shooters),
      getShooterDashboard: vi.fn().mockResolvedValue(makeDashboard()),
    });
    const result = await handleShooter(client, BASE_URL, "Jane");
    expect(result.content).toContain("Found 2 shooters");
    expect(result.content).toContain("Jane Smith (Club B)");
  });
});

// --- /link ---

describe("handleLink", () => {
  it("stores guild-scoped mapping on success", async () => {
    const store: Record<string, string> = {};
    const kv = mockKV(store);
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue([makeShooterResult()]),
    });

    const msg = await handleLink(client, kv, "guild-1", "user-1", "Jane");
    expect(msg).toContain("Linked your account to **Jane Doe**");
    expect(msg).toContain("/me");
    expect(kv.put).toHaveBeenCalledWith(
      "g:guild-1:link:user-1",
      JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    );
  });

  it("returns error when no shooter found", async () => {
    const client = mockClient();
    const kv = mockKV();
    const msg = await handleLink(client, kv, "guild-1", "user-1", "nobody");
    expect(msg).toContain("No shooter found");
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("suggests alternatives when multiple results", async () => {
    const shooters = [
      makeShooterResult({ name: "Jane Doe", club: "Club A" }),
      makeShooterResult({ name: "Jane Smith", club: "Club B" }),
    ];
    const client = mockClient({
      searchShooters: vi.fn().mockResolvedValue(shooters),
    });
    const kv = mockKV();
    const msg = await handleLink(client, kv, "guild-1", "user-1", "Jane");
    expect(msg).toContain("Wrong person?");
    expect(msg).toContain("Jane Smith (Club B)");
  });
});

describe("getLinkedShooter", () => {
  it("returns linked shooter from guild-scoped key", async () => {
    const store = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);
    const result = await getLinkedShooter(kv, "guild-1", "user-1");
    expect(result).toEqual({ shooterId: 42, name: "Jane Doe" });
  });

  it("returns null when no link exists", async () => {
    const kv = mockKV();
    const result = await getLinkedShooter(kv, "guild-1", "user-1");
    expect(result).toBeNull();
  });

  it("does not leak data across guilds", async () => {
    const store = {
      "g:guild-1:link:user-1": JSON.stringify({ shooterId: 42, name: "Jane Doe" }),
    };
    const kv = mockKV(store);
    const result = await getLinkedShooter(kv, "guild-2", "user-1");
    expect(result).toBeNull();
  });
});

// --- /help ---

describe("handleHelp", () => {
  it("returns an embed with command descriptions", () => {
    const result = handleHelp();
    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0].title).toContain("Range Officer");
    expect(result.embeds[0].fields!.length).toBeGreaterThanOrEqual(4);
  });
});

describe("WELCOME_EMBED", () => {
  it("has a different title from the help embed", () => {
    const help = handleHelp();
    expect(WELCOME_EMBED.title).not.toBe(help.embeds[0].title);
    expect(WELCOME_EMBED.title).toContain("entered the range");
  });

  it("has a footer", () => {
    expect(WELCOME_EMBED.footer?.text).toContain("/help");
  });
});
