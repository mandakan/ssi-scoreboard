// Regression: /api/popular-matches must never expose non-public matches.
//
// SSI's visibility enum collapses into three classes (see lib/visibility.ts):
// public ("pub"), unlisted ("lim"), organizer-published ("res"|"csd"|"clb").
// Only "public" may surface here -- unlisted / organizer-published matches
// are intentionally not advertised by the organizer, and the popular grid is
// a discovery surface (used in the UI homepage and via the MCP
// `get_popular_matches` tool). See feedback memory
// `feedback_popular_matches_visibility.md` for the rationale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  getPopularKeys: vi.fn<
    (maxAgeSeconds: number, limit: number) => Promise<{ key: string; hits: number }[]>
  >(),
}));
const matchStoreMock = vi.hoisted(() => ({
  getMatchDataWithFallback: vi.fn<(key: string) => Promise<string | null>>(),
}));
const tagMock = vi.hoisted(() => ({
  maybeTagAsMcp: vi.fn(),
}));

vi.mock("@/lib/db-impl", () => ({ default: dbMock }));
vi.mock("@/lib/match-data-store", () => matchStoreMock);
vi.mock("@/lib/telemetry-context", () => tagMock);

function cacheKey(ct: number, id: string): string {
  return `gql:GetMatch:${JSON.stringify({ ct, id })}`;
}

function entry(opts: {
  name: string;
  visibility: string;
  scoringCompleted?: number;
}): string {
  return JSON.stringify({
    data: {
      event: {
        name: opts.name,
        venue: "Test Range",
        starts: "2026-05-01T08:00:00Z",
        scoring_completed: opts.scoringCompleted ?? 100,
        visibility: opts.visibility,
      },
    },
    cachedAt: "2026-05-01T10:00:00Z",
  });
}

beforeEach(() => {
  dbMock.getPopularKeys.mockReset();
  matchStoreMock.getMatchDataWithFallback.mockReset();
  tagMock.maybeTagAsMcp.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("GET /api/popular-matches -- visibility filter", () => {
  it("includes matches with visibility=pub", async () => {
    const { GET } = await import("@/app/api/popular-matches/route");
    const k = cacheKey(22, "100");
    dbMock.getPopularKeys.mockResolvedValue([{ key: k, hits: 10 }]);
    matchStoreMock.getMatchDataWithFallback.mockImplementation(async (key) =>
      key === k ? entry({ name: "Public Open", visibility: "pub" }) : null,
    );

    const res = await GET(new Request("http://x/api/popular-matches"));
    const body = (await res.json()) as Array<{ id: string; name: string }>;

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: "100", name: "Public Open" });
  });

  it.each([
    ["lim", "Unlisted Cup"],
    ["res", "Restricted Match"],
    ["csd", "Closed Match"],
    ["clb", "Club-Only Match"],
  ])("excludes matches with visibility=%s", async (visibility, name) => {
    const { GET } = await import("@/app/api/popular-matches/route");
    const k = cacheKey(22, "200");
    dbMock.getPopularKeys.mockResolvedValue([{ key: k, hits: 99 }]);
    matchStoreMock.getMatchDataWithFallback.mockImplementation(async (key) =>
      key === k ? entry({ name, visibility }) : null,
    );

    const res = await GET(new Request("http://x/api/popular-matches"));
    const body = (await res.json()) as unknown[];

    expect(body).toEqual([]);
  });

  it("excludes matches with missing visibility (defensive)", async () => {
    // classifyVisibility() falls back to organizer-published on
    // null/undefined/unknown codes, so missing visibility must be treated
    // as non-public to avoid leaking a future SSI enum addition.
    const { GET } = await import("@/app/api/popular-matches/route");
    const k = cacheKey(22, "300");
    dbMock.getPopularKeys.mockResolvedValue([{ key: k, hits: 5 }]);
    const payload = JSON.stringify({
      data: { event: { name: "Mystery", venue: null, starts: null, scoring_completed: 0 } },
      cachedAt: "now",
    });
    matchStoreMock.getMatchDataWithFallback.mockResolvedValue(payload);

    const res = await GET(new Request("http://x/api/popular-matches"));
    const body = (await res.json()) as unknown[];

    expect(body).toEqual([]);
  });

  it("filters a mixed batch -- keeps public, drops the rest", async () => {
    const { GET } = await import("@/app/api/popular-matches/route");
    const kPub = cacheKey(22, "1");
    const kLim = cacheKey(22, "2");
    const kRes = cacheKey(22, "3");
    const kPub2 = cacheKey(22, "4");
    dbMock.getPopularKeys.mockResolvedValue([
      { key: kLim, hits: 100 },
      { key: kPub, hits: 50 },
      { key: kRes, hits: 30 },
      { key: kPub2, hits: 10 },
    ]);
    matchStoreMock.getMatchDataWithFallback.mockImplementation(async (key) => {
      if (key === kPub) return entry({ name: "Pub A", visibility: "pub" });
      if (key === kLim) return entry({ name: "Lim", visibility: "lim" });
      if (key === kRes) return entry({ name: "Res", visibility: "res" });
      if (key === kPub2) return entry({ name: "Pub B", visibility: "pub" });
      return null;
    });

    const res = await GET(new Request("http://x/api/popular-matches"));
    const body = (await res.json()) as Array<{ id: string; name: string }>;

    expect(body.map((m) => m.id)).toEqual(["1", "4"]);
  });
});
