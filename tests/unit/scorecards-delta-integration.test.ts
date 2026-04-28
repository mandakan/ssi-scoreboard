import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────

const cacheMock = vi.hoisted(() => ({
  setIfAbsent: vi.fn<(key: string, val: string, ttl: number) => Promise<boolean>>(),
  set: vi.fn<(key: string, val: string, ttl: number | null) => Promise<void>>(),
  expire: vi.fn<(key: string, ttl: number) => Promise<void>>(),
  del: vi.fn<(key: string) => Promise<void>>(),
  get: vi.fn<(key: string) => Promise<string | null>>(),
  persist: vi.fn<(key: string) => Promise<void>>(),
}));

const dbMock = vi.hoisted(() => ({
  recordMatchAccess: vi.fn(() => Promise.resolve()),
  getMatchDataCache: vi.fn(() => Promise.resolve(null)),
  getMatchDataCacheStoredAt: vi.fn(() => Promise.resolve(null)),
  setMatchDataCache: vi.fn(() => Promise.resolve()),
}));

const upstreamMock = vi.hoisted(() => ({
  markUpstreamDegraded: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));
vi.mock("@/lib/db-impl", () => ({ default: dbMock }));
vi.mock("@/lib/upstream-status", () => upstreamMock);
vi.mock("@/lib/background-impl", () => ({
  afterResponse: (p: Promise<unknown>) => {
    void p.catch(() => {});
  },
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map()),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

const KEY = 'gql:GetMatchScorecards:{"ct":22,"id":"26547"}';
const QUERY = "query GetMatchScorecards { x }";
const VARS = { ct: 22, id: "26547" };
const MATCH = { ct: 22, id: "26547" };
const SIDECAR = "probe:match-state:22:26547";
const FORCE = "force-refresh:22:26547";

function probeResponse(body: { updated?: string | null; status?: string | null; results?: string | null } | null) {
  return new Response(JSON.stringify({ data: { event: body } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deltaResponse(scorecards: unknown[]) {
  return new Response(JSON.stringify({ data: { event: { scorecards } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fullResponse() {
  return new Response(
    JSON.stringify({
      data: { event: { stages: [{ id: "100", number: 1, name: "S1", max_points: 80, scorecards: [] }] } },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function cachedScorecardsEntry(cachedAtIso: string) {
  return JSON.stringify({
    data: {
      event: {
        stages: [
          {
            id: "100",
            number: 1,
            name: "S1",
            max_points: 80,
            scorecards: [
              { points: 60, hitfactor: 4.5, competitor: { id: "c1", first_name: "F1", last_name: "L1" } },
            ],
          },
          { id: "101", number: 2, name: "S2", max_points: 100, scorecards: [] },
        ],
      },
    },
    cachedAt: cachedAtIso,
    v: 12, // CACHE_SCHEMA_VERSION at time of writing — must match
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("scorecards delta integration", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cacheMock.setIfAbsent.mockReset();
    cacheMock.set.mockReset();
    cacheMock.expire.mockReset();
    cacheMock.del.mockReset();
    cacheMock.get.mockReset();
    cacheMock.setIfAbsent.mockResolvedValue(true);
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.expire.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);
    upstreamMock.markUpstreamDegraded.mockClear();

    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    process.env.SSI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SCORECARDS_DELTA_ENABLED;
    delete process.env.SCORECARDS_DELTA_MAX_AGE_SECONDS;
    delete process.env.MATCH_PROBE_ENABLED;
  });

  it("attempts a delta merge on probe=changed for scorecards keys", async () => {
    // Re-read to confirm cache schema version, then write the value.
    const { CACHE_SCHEMA_VERSION } = await import("@/lib/constants");
    const cachedAt = new Date(Date.now() - 30_000).toISOString(); // 30s ago — well within reconcile window
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        const entry = JSON.parse(cachedScorecardsEntry(cachedAt));
        entry.v = CACHE_SCHEMA_VERSION;
        return JSON.stringify(entry);
      }
      return null;
    });

    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(
        deltaResponse([
          {
            stage: { id: "100" },
            points: 75,
            hitfactor: 5.2,
            competitor: { id: "c1", first_name: "F1", last_name: "L1" },
          },
        ]),
      );

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    // 2 fetches: probe + delta. NOT 3 (no full refetch).
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // The merged snapshot was written back to KEY.
    const writeCalls = cacheMock.set.mock.calls.filter((c) => c[0] === KEY);
    expect(writeCalls.length).toBe(1);
    const written = JSON.parse(writeCalls[0]![1] as string);
    // Merged scorecard reflects the delta values.
    const c1 = written.data.event.stages.find((s: { id: string }) => s.id === "100").scorecards.find((sc: { competitor: { id: string } }) => sc.competitor.id === "c1");
    expect(c1.points).toBe(75);
    // Original cachedAt must be preserved (reconcile timer).
    expect(written.cachedAt).toBe(cachedAt);
  });

  it("forces a reconcile (full refetch) when the cached entry is older than SCORECARDS_DELTA_MAX_AGE_SECONDS", async () => {
    process.env.SCORECARDS_DELTA_MAX_AGE_SECONDS = "120"; // 2 min ceiling
    const { CACHE_SCHEMA_VERSION } = await import("@/lib/constants");
    const staleCachedAt = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        const entry = JSON.parse(cachedScorecardsEntry(staleCachedAt));
        entry.v = CACHE_SCHEMA_VERSION;
        return JSON.stringify(entry);
      }
      return null;
    });

    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    // 2 fetches: probe + full refresh. No delta query.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to full refetch when merge fails (delta references unknown stage)", async () => {
    const { CACHE_SCHEMA_VERSION } = await import("@/lib/constants");
    const cachedAt = new Date(Date.now() - 30_000).toISOString();
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        const entry = JSON.parse(cachedScorecardsEntry(cachedAt));
        entry.v = CACHE_SCHEMA_VERSION;
        return JSON.stringify(entry);
      }
      return null;
    });

    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(
        deltaResponse([
          { stage: { id: "999" }, points: 10, competitor: { id: "c9" } }, // unknown stage
        ]),
      )
      .mockResolvedValueOnce(fullResponse());

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    // 3 fetches: probe + failed delta + full refresh fallback.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("kill switch SCORECARDS_DELTA_ENABLED=off skips the delta path entirely", async () => {
    process.env.SCORECARDS_DELTA_ENABLED = "off";
    const { CACHE_SCHEMA_VERSION } = await import("@/lib/constants");
    const cachedAt = new Date(Date.now() - 30_000).toISOString();
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        const entry = JSON.parse(cachedScorecardsEntry(cachedAt));
        entry.v = CACHE_SCHEMA_VERSION;
        return JSON.stringify(entry);
      }
      return null;
    });

    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    // 2 fetches: probe + full refresh. No delta query.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("force-refresh sentinel bypasses probe and delta entirely, then clears itself", async () => {
    cacheMock.get.mockImplementation(async (k) => {
      if (k === FORCE) return "1"; // sentinel set
      return null;
    });
    fetchSpy.mockResolvedValueOnce(fullResponse());

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    // Only one fetch — the full refresh — no probe.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Sentinel must be cleared after the full refresh succeeds.
    expect(cacheMock.del).toHaveBeenCalledWith(FORCE);
  });

  it("does NOT attempt delta on a match key (only scorecards keys are delta-eligible)", async () => {
    const matchKey = 'gql:GetMatch:{"ct":22,"id":"26547"}';
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      return null;
    });

    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    await refreshCachedMatchQuery(matchKey, "query GetMatch { x }", VARS, 90, MATCH);

    // 2 fetches: probe + full refresh. No delta query was attempted.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
