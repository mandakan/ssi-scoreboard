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

function probeResponse(body: { updated?: string | null; status?: string | null; results?: string | null } | null) {
  return new Response(JSON.stringify({ data: { event: body } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fullResponse() {
  return new Response(JSON.stringify({ data: { event: { stages: [] } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("refreshCachedMatchQuery — probe-aware refresh", () => {
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
  });

  it("skips the full refetch when probe state matches sidecar", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    const freshCachedAt = new Date(Date.now() - 5_000).toISOString(); // 5s ago
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        return JSON.stringify({ data: {}, cachedAt: freshCachedAt, v: 1 });
      }
      return null;
    });
    fetchSpy.mockResolvedValue(
      probeResponse({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" }),
    );

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).toHaveBeenCalledTimes(1); // probe only
    expect(cacheMock.set).not.toHaveBeenCalledWith(KEY, expect.any(String), expect.any(Number));
    expect(cacheMock.expire).toHaveBeenCalledWith(KEY, 90);
    expect(cacheMock.expire).toHaveBeenCalledWith(SIDECAR, 90);
  });

  it("forces a full refetch when cached age exceeds MATCH_PROBE_MAX_SKIP_AGE_SECONDS", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    const staleCachedAt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      if (k === KEY) {
        return JSON.stringify({ data: {}, cachedAt: staleCachedAt, v: 1 });
      }
      return null;
    });
    // Probe says nothing changed, but the cached entry is older than the
    // 5-minute safety ceiling — we must refetch anyway.
    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // probe + safety-net refetch
    expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
    expect(cacheMock.set).toHaveBeenCalledWith(SIDECAR, expect.any(String), 90);
  });

  it("kill switch: MATCH_PROBE_ENABLED=off bypasses the probe entirely", async () => {
    process.env.MATCH_PROBE_ENABLED = "off";
    try {
      const { refreshCachedMatchQuery } = await import("@/lib/graphql");
      fetchSpy.mockResolvedValue(fullResponse());

      await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

      // Only the full fetch should run — no probe, no sidecar read.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
      // Sidecar must NOT be touched in kill-switch mode.
      expect(cacheMock.set).not.toHaveBeenCalledWith(SIDECAR, expect.any(String), expect.any(Number));
    } finally {
      delete process.env.MATCH_PROBE_ENABLED;
    }
  });

  it("does a full refetch when probe state differs from sidecar", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      return null;
    });
    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:05:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).toHaveBeenCalledTimes(2); // probe + full refetch
    expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
    // Sidecar should be updated with the new state
    expect(cacheMock.set).toHaveBeenCalledWith(
      SIDECAR,
      expect.stringContaining('"updated":"2026-04-28T10:05:00Z"'),
      90,
    );
  });

  it("does a full refetch on first-seen (no sidecar yet)", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.get.mockResolvedValue(null);
    fetchSpy
      .mockResolvedValueOnce(probeResponse({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" }))
      .mockResolvedValueOnce(fullResponse());

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
    expect(cacheMock.set).toHaveBeenCalledWith(SIDECAR, expect.any(String), 90);
  });

  it("falls back to a full refetch when the probe itself fails", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.get.mockResolvedValue(null);
    fetchSpy
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(fullResponse());

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
    // Sidecar must NOT be written when we never had a successful probe.
    expect(cacheMock.set).not.toHaveBeenCalledWith(SIDECAR, expect.any(String), expect.any(Number));
  });

  it("releases the inflight lock in all cases", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.get.mockResolvedValue(null);
    fetchSpy.mockRejectedValue(new Error("network down"));

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(cacheMock.del).toHaveBeenCalledWith(`inflight:${KEY}`);
  });

  it("skips entirely when the inflight lock is already held", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.setIfAbsent.mockResolvedValue(false);

    await refreshCachedMatchQuery(KEY, QUERY, VARS, 90, MATCH);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
    expect(cacheMock.expire).not.toHaveBeenCalled();
  });

  it("does not extend cache TTL on skip when ttlSeconds is null", async () => {
    const { refreshCachedMatchQuery } = await import("@/lib/graphql");
    cacheMock.get.mockImplementation(async (k) => {
      if (k === SIDECAR) {
        return JSON.stringify({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" });
      }
      return null;
    });
    fetchSpy.mockResolvedValue(
      probeResponse({ updated: "2026-04-28T10:00:00Z", status: "on", results: "org" }),
    );

    await refreshCachedMatchQuery(KEY, QUERY, VARS, null, MATCH);

    // Permanent entries — no TTL extension; refetch was still skipped.
    expect(cacheMock.expire).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalledWith(KEY, expect.any(String), expect.any(Number));
  });
});
