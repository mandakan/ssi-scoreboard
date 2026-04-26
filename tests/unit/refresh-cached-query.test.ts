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

vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));
vi.mock("@/lib/db-impl", () => ({ default: dbMock }));
vi.mock("@/lib/background-impl", () => ({
  // Run background work synchronously in tests so we can assert on its effects.
  afterResponse: (p: Promise<unknown>) => {
    void p.catch(() => {});
  },
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map()),
}));

// ─── Tests ────────────────────────────────────────────────────────────────

describe("refreshCachedQuery — stale-on-error", () => {
  const KEY = 'gql:GetMatch:{"ct":22,"id":"26547"}';
  const QUERY = "query GetMatch { x }";
  const VARS = { ct: 22, id: "26547" };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cacheMock.setIfAbsent.mockReset();
    cacheMock.set.mockReset();
    cacheMock.expire.mockReset();
    cacheMock.del.mockReset();
    cacheMock.setIfAbsent.mockResolvedValue(true); // acquire lock
    cacheMock.set.mockResolvedValue(undefined);
    cacheMock.expire.mockResolvedValue(undefined);
    cacheMock.del.mockResolvedValue(undefined);

    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    process.env.SSI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extends the cached entry's TTL when the upstream fetch fails", async () => {
    const { refreshCachedQuery } = await import("@/lib/graphql");
    fetchSpy.mockResolvedValue(
      new Response("upstream down", { status: 502 }),
    );

    await refreshCachedQuery(KEY, QUERY, VARS, 90);

    // The fresh write should NOT have happened — fetch failed.
    expect(cacheMock.set).not.toHaveBeenCalledWith(KEY, expect.any(String), 90);
    // But the existing entry's TTL should have been extended back to 90s.
    expect(cacheMock.expire).toHaveBeenCalledWith(KEY, 90);
  });

  it("does not extend TTL when the original ttl is null (permanent)", async () => {
    const { refreshCachedQuery } = await import("@/lib/graphql");
    fetchSpy.mockResolvedValue(
      new Response("upstream down", { status: 502 }),
    );

    await refreshCachedQuery(KEY, QUERY, VARS, null);

    expect(cacheMock.expire).not.toHaveBeenCalled();
  });

  it("writes fresh data on success and does NOT call expire", async () => {
    const { refreshCachedQuery } = await import("@/lib/graphql");
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { event: { name: "ok" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await refreshCachedQuery(KEY, QUERY, VARS, 90);

    expect(cacheMock.set).toHaveBeenCalledWith(KEY, expect.any(String), 90);
    expect(cacheMock.expire).not.toHaveBeenCalled();
  });

  it("releases the inflight lock even when the fetch fails", async () => {
    const { refreshCachedQuery } = await import("@/lib/graphql");
    fetchSpy.mockRejectedValue(new Error("network down"));

    await refreshCachedQuery(KEY, QUERY, VARS, 90);

    expect(cacheMock.del).toHaveBeenCalledWith(`inflight:${KEY}`);
    expect(cacheMock.expire).toHaveBeenCalledWith(KEY, 90);
  });

  it("skips the work entirely if the lock was already taken", async () => {
    const { refreshCachedQuery } = await import("@/lib/graphql");
    cacheMock.setIfAbsent.mockResolvedValue(false);

    await refreshCachedQuery(KEY, QUERY, VARS, 90);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(cacheMock.expire).not.toHaveBeenCalled();
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});
