import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (same harness as refresh-cached-match-query.test.ts) ───────────

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
vi.mock("@/lib/upstream-status", () => ({
  markUpstreamDegraded: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/background-impl", () => ({
  afterResponse: (p: Promise<unknown>) => {
    void p.catch(() => {});
  },
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map()),
}));
vi.mock("@/lib/ssi-auth", () => ({
  getJwt: vi.fn(() => Promise.resolve("test-jwt")),
  JWT_EXPIRED_ERROR_PATTERNS: ["Signature has expired"],
}));

import { refreshScorecardsIncremental, stageProbeSidecarKey } from "@/lib/scorecards-archive";
import { forceRefreshKey, clearMatchSyncProbeMemo } from "@/lib/graphql";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const CT = 22;
const MATCH_ID = "26547";
const SNAPSHOT_KEY = `gql:GetMatchScorecards:{"ct":22,"id":"26547"}`;
const SIDECAR_KEY = stageProbeSidecarKey(CT, MATCH_ID);
const LOCK_KEY = `inflight:${SNAPSHOT_KEY}`;

interface ProbeStage {
  id: string;
  updated?: string;
  scorecards_count?: number;
  scoring_progress?: { scored: number; total: number };
}

function stageState(id: string, over: Partial<{ updated: string; count: number; scored: number; total: number }> = {}) {
  return { updated: "2026-08-15T08:00:00Z", count: 5, scored: 5, total: 30, ...over };
}

function probeStage(id: string, over: Partial<{ updated: string; count: number; scored: number; total: number }> = {}): ProbeStage {
  const s = stageState(id, over);
  return { id, updated: s.updated, scorecards_count: s.count, scoring_progress: { scored: s.scored, total: s.total } };
}

function snapshotStage(id: string, number: number) {
  return { id, number, name: `Stage ${number}`, max_points: 60, scorecards: [{ competitor: { id: "1" }, created: "x" }] };
}

function makeSnapshot(stageIds: Array<[string, number]>) {
  return {
    data: { event: { stages: stageIds.map(([id, n]) => snapshotStage(id, n)) } },
    cachedAt: "2026-08-15T10:00:00.000Z",
    v: CACHE_SCHEMA_VERSION,
  };
}

function makeSidecar(ids: string[], over: Record<string, ReturnType<typeof stageState>> = {}, lastFullSyncAt = new Date().toISOString()) {
  const stages: Record<string, ReturnType<typeof stageState>> = {};
  for (const id of ids) stages[id] = over[id] ?? stageState(id);
  return { v: CACHE_SCHEMA_VERSION, stages, lastFullSyncAt };
}

const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

function stubUpstream(probeStages: ProbeStage[] | null) {
  fetchSpy.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    if (body.query.includes("MatchSyncProbe")) {
      if (probeStages === null) {
        return new Response(JSON.stringify({ errors: [{ message: "probe boom" }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: {
            event: {
              status: "on",
              results: "none",
              updated: "2026-08-15T07:00:00Z",
              is_live_scores_accessible: true,
              stages: probeStages,
            },
          },
        }),
        { status: 200 },
      );
    }
    // Per-stage scorecards fetch (full or delta). Delta responses carry the
    // response-only `updated` field that must be stripped before caching.
    const id = String(body.variables.id);
    const card = body.query.includes("GetStageScorecardsDelta")
      ? { competitor: { id: "7" }, created: "y", updated: "2026-08-15T09:00:00Z" }
      : { competitor: { id: "7" }, created: "y" };
    return new Response(
      JSON.stringify({
        data: {
          stage: { id, number: parseInt(id, 10) - 99, name: `Stage ${id}`, max_points: 60, scorecards: [card] },
        },
      }),
      { status: 200 },
    );
  });
}

function stageFetchIds(): string[] {
  return fetchSpy.mock.calls
    .map((c) => JSON.parse(String(c[1]?.body)) as { query: string; variables: Record<string, unknown> })
    .filter((b) => b.query.includes("GetStageScorecards"))
    .map((b) => String(b.variables.id));
}

function writtenSnapshot(): { data: { event: { stages: Array<{ id: string; scorecards: unknown[] }> } }; cachedAt: string; v: number } | null {
  const call = cacheMock.set.mock.calls.filter((c) => c[0] === SNAPSHOT_KEY).pop();
  return call ? JSON.parse(call[1] as string) : null;
}

const baseArgs = {
  ct: CT,
  matchId: MATCH_ID,
  stages: [
    { ct: 24, id: "100" },
    { ct: 24, id: "101" },
  ],
  ttlSeconds: 120,
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
  Object.values(cacheMock).forEach((fn) => fn.mockReset());
  Object.values(dbMock).forEach((fn) => fn.mockReset());
  process.env.SSI_API_KEY = "test-key";
  delete process.env.MATCH_PROBE_ENABLED;
  delete process.env.SCORECARDS_DELTA_ENABLED;
  clearMatchSyncProbeMemo();
  cacheMock.setIfAbsent.mockResolvedValue(true);
  cacheMock.set.mockResolvedValue(undefined);
  cacheMock.expire.mockResolvedValue(undefined);
  cacheMock.del.mockResolvedValue(undefined);
  // Default cache content: snapshot + sidecar in sync for stages 100, 101.
  const snapshot = makeSnapshot([["100", 1], ["101", 2]]);
  const sidecar = makeSidecar(["100", "101"]);
  cacheMock.get.mockImplementation(async (key: string) => {
    if (key === SNAPSHOT_KEY) return JSON.stringify(snapshot);
    if (key === SIDECAR_KEY) return JSON.stringify(sidecar);
    return null; // force-refresh sentinel absent
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("refreshScorecardsIncremental", () => {
  it("probe unchanged: no stage fetches, TTL extended, snapshot not rewritten", async () => {
    stubUpstream([probeStage("100"), probeStage("101")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds()).toEqual([]);
    expect(cacheMock.expire).toHaveBeenCalledWith(SNAPSHOT_KEY, 120);
    expect(cacheMock.set.mock.calls.some((c) => c[0] === SNAPSHOT_KEY)).toBe(false);
  });

  it("one stage changed: fetches only that stage and replaces it in the snapshot", async () => {
    stubUpstream([probeStage("100"), probeStage("101", { scored: 9, count: 9 })]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds()).toEqual(["101"]);
    const written = writtenSnapshot();
    expect(written).not.toBeNull();
    const ids = written!.data.event.stages.map((s) => s.id);
    expect(ids).toEqual(["100", "101"]);
    // Stage 101 replaced with the freshly fetched card (competitor 7).
    const s101 = written!.data.event.stages.find((s) => s.id === "101")!;
    expect(JSON.stringify(s101.scorecards)).toContain('"7"');
    // Stage 100 kept from the old snapshot (competitor 1).
    const s100 = written!.data.event.stages.find((s) => s.id === "100")!;
    expect(JSON.stringify(s100.scorecards)).toContain('"1"');
  });

  it("new stage in probe: fetches it, adds it, and sets the match force-refresh sentinel", async () => {
    stubUpstream([probeStage("100"), probeStage("101"), probeStage("102")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds()).toEqual(["102"]);
    const written = writtenSnapshot();
    expect(written!.data.event.stages.map((s) => s.id)).toEqual(["100", "101", "102"]);
    expect(
      cacheMock.set.mock.calls.some((c) => c[0] === forceRefreshKey(CT, MATCH_ID)),
    ).toBe(true);
  });

  it("stage removed upstream: drops it from the snapshot without any stage fetch", async () => {
    stubUpstream([probeStage("100")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds()).toEqual([]);
    const written = writtenSnapshot();
    expect(written!.data.event.stages.map((s) => s.id)).toEqual(["100"]);
  });

  it("missing sidecar: full resync of every probe stage", async () => {
    const snapshot = makeSnapshot([["100", 1], ["101", 2]]);
    cacheMock.get.mockImplementation(async (key: string) =>
      key === SNAPSHOT_KEY ? JSON.stringify(snapshot) : null,
    );
    stubUpstream([probeStage("100"), probeStage("101")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds().sort()).toEqual(["100", "101"]);
    expect(writtenSnapshot()).not.toBeNull();
    // Sidecar written with a fresh lastFullSyncAt
    const sidecarWrite = cacheMock.set.mock.calls.filter((c) => c[0] === SIDECAR_KEY).pop();
    expect(sidecarWrite).toBeDefined();
    expect(JSON.parse(sidecarWrite![1] as string).lastFullSyncAt).toBeTruthy();
  });

  it("sidecar with stale schema version: full resync", async () => {
    const snapshot = makeSnapshot([["100", 1], ["101", 2]]);
    const staleSidecar = { ...makeSidecar(["100", "101"]), v: CACHE_SCHEMA_VERSION - 1 };
    cacheMock.get.mockImplementation(async (key: string) => {
      if (key === SNAPSHOT_KEY) return JSON.stringify(snapshot);
      if (key === SIDECAR_KEY) return JSON.stringify(staleSidecar);
      return null;
    });
    stubUpstream([probeStage("100"), probeStage("101")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds().sort()).toEqual(["100", "101"]);
  });

  it("full-resync ceiling: unchanged probe but lastFullSyncAt older than the ceiling forces a full resync", async () => {
    const snapshot = makeSnapshot([["100", 1], ["101", 2]]);
    const oldSync = new Date(Date.now() - 1000 * 1000).toISOString(); // > 900s ago
    const sidecar = makeSidecar(["100", "101"], {}, oldSync);
    cacheMock.get.mockImplementation(async (key: string) => {
      if (key === SNAPSHOT_KEY) return JSON.stringify(snapshot);
      if (key === SIDECAR_KEY) return JSON.stringify(sidecar);
      return null;
    });
    stubUpstream([probeStage("100"), probeStage("101")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds().sort()).toEqual(["100", "101"]);
  });

  it("lock held by another refresh: does nothing (no probe, no fetches)", async () => {
    cacheMock.setIfAbsent.mockResolvedValue(false);
    stubUpstream([probeStage("100")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("acquires and releases the snapshot inflight lock", async () => {
    stubUpstream([probeStage("100"), probeStage("101")]);
    await refreshScorecardsIncremental(baseArgs);
    expect(cacheMock.setIfAbsent.mock.calls[0][0]).toBe(LOCK_KEY);
    expect(cacheMock.del).toHaveBeenCalledWith(LOCK_KEY);
  });

  it("probe failure: falls back to a full resync using the caller's stage refs", async () => {
    stubUpstream(null); // probe errors
    await refreshScorecardsIncremental(baseArgs);
    expect(stageFetchIds().sort()).toEqual(["100", "101"]);
    expect(writtenSnapshot()).not.toBeNull();
  });

  it("delta mode: changed stage fetched via updated_after and merged by competitor", async () => {
    process.env.SCORECARDS_DELTA_ENABLED = "on";
    // Probe: stage 101 changed, now has 2 cards (existing competitor 1 + new competitor 7).
    stubUpstream([probeStage("100"), probeStage("101", { scored: 2, count: 2, updated: "2026-08-15T09:00:00Z" })]);
    await refreshScorecardsIncremental(baseArgs);
    const deltaCalls = fetchSpy.mock.calls
      .map((c) => JSON.parse(String(c[1]?.body)) as { query: string; variables: Record<string, unknown> })
      .filter((b) => b.query.includes("GetStageScorecardsDelta"));
    expect(deltaCalls).toHaveLength(1);
    // Watermark = the sidecar's previous IpscStageNode.updated for stage 101.
    expect(deltaCalls[0].variables.updatedAfter).toBe("2026-08-15T08:00:00Z");
    const written = writtenSnapshot();
    const s101 = written!.data.event.stages.find((s) => s.id === "101")!;
    // Merged: old competitor 1 kept, delta competitor 7 added, no `updated` leaked.
    expect(s101.scorecards).toHaveLength(2);
    expect(JSON.stringify(s101.scorecards)).not.toContain('"updated"');
  });

  it("delta mode: count mismatch falls back to a whole-stage refetch", async () => {
    process.env.SCORECARDS_DELTA_ENABLED = "on";
    // Probe claims 9 cards but delta merge would only produce 2 → full stage refetch.
    stubUpstream([probeStage("100"), probeStage("101", { scored: 9, count: 9, updated: "2026-08-15T09:00:00Z" })]);
    await refreshScorecardsIncremental(baseArgs);
    const bodies = fetchSpy.mock.calls
      .map((c) => JSON.parse(String(c[1]?.body)) as { query: string; variables: Record<string, unknown> });
    expect(bodies.some((b) => b.query.includes("GetStageScorecardsDelta"))).toBe(true);
    // Fallback whole-stage fetch also fired for 101.
    const fullCalls = bodies.filter(
      (b) => b.query.includes("GetStageScorecards") && !b.query.includes("Delta") && !b.query.includes("MatchSyncProbe"),
    );
    expect(fullCalls.map((b) => String(b.variables.id))).toEqual(["101"]);
  });

  it("writes the snapshot before the sidecar (crash between them is safe)", async () => {
    stubUpstream([probeStage("100"), probeStage("101", { scored: 9 })]);
    await refreshScorecardsIncremental(baseArgs);
    const keys = cacheMock.set.mock.calls.map((c) => c[0]);
    const snapIdx = keys.indexOf(SNAPSHOT_KEY);
    const sideIdx = keys.indexOf(SIDECAR_KEY);
    expect(snapIdx).toBeGreaterThanOrEqual(0);
    expect(sideIdx).toBeGreaterThan(snapIdx);
  });
});
