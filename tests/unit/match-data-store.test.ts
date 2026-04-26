import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseMatchCacheKey } from "@/lib/match-data-store";

// Mocks for the active-D1-write tests below. Hoisted vars so vi.mock can
// reference them — vi.mock() runs before module imports.
const dbMock = vi.hoisted(() => ({
  getMatchDataCacheStoredAt: vi.fn<(k: string) => Promise<string | null>>(),
  setMatchDataCache: vi.fn<
    (
      k: string,
      data: string,
      meta: { keyType: string; ct: number; matchId: string; schemaVersion: number },
    ) => Promise<void>
  >(),
}));
const cacheMock = vi.hoisted(() => ({
  expire: vi.fn<(k: string, ttl: number) => Promise<void>>(),
}));

vi.mock("@/lib/db-impl", () => ({
  default: dbMock,
}));
vi.mock("@/lib/cache-impl", () => ({
  default: cacheMock,
}));

describe("parseMatchCacheKey", () => {
  it("parses gql:GetMatch keys", () => {
    const result = parseMatchCacheKey('gql:GetMatch:{"ct":22,"id":"26547"}');
    expect(result).toEqual({ keyType: "match", ct: 22, matchId: "26547" });
  });

  it("parses gql:GetMatchScorecards keys", () => {
    const result = parseMatchCacheKey('gql:GetMatchScorecards:{"ct":22,"id":"26547"}');
    expect(result).toEqual({ keyType: "scorecards", ct: 22, matchId: "26547" });
  });

  it("parses computed:matchglobal keys", () => {
    const result = parseMatchCacheKey("computed:matchglobal:22:26547");
    expect(result).toEqual({ keyType: "matchglobal", ct: 22, matchId: "26547" });
  });

  it("returns null for unrecognized keys", () => {
    expect(parseMatchCacheKey("computed:shooter:123:dashboard")).toBeNull();
    expect(parseMatchCacheKey("gql:GetEvents:{}")).toBeNull();
    expect(parseMatchCacheKey("random:key")).toBeNull();
  });

  it("returns null for malformed JSON in gql keys", () => {
    expect(parseMatchCacheKey("gql:GetMatch:{invalid}")).toBeNull();
    expect(parseMatchCacheKey("gql:GetMatchScorecards:{invalid}")).toBeNull();
  });

  it("returns null for matchglobal with missing parts", () => {
    expect(parseMatchCacheKey("computed:matchglobal:")).toBeNull();
    expect(parseMatchCacheKey("computed:matchglobal:22")).toBeNull();
  });

  it("handles numeric match IDs in matchglobal keys", () => {
    const result = parseMatchCacheKey("computed:matchglobal:22:99999");
    expect(result).toEqual({ keyType: "matchglobal", ct: 22, matchId: "99999" });
  });
});

describe("persistActiveMatchToD1", () => {
  const KEY = 'gql:GetMatch:{"ct":22,"id":"26547"}';
  const PAYLOAD = JSON.stringify({ data: { event: { name: "x" } }, cachedAt: "now", v: 12 });

  beforeEach(() => {
    dbMock.getMatchDataCacheStoredAt.mockReset();
    dbMock.setMatchDataCache.mockReset();
  });

  it("writes to D1 when no existing row exists", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    dbMock.getMatchDataCacheStoredAt.mockResolvedValue(null);
    dbMock.setMatchDataCache.mockResolvedValue(undefined);

    await persistActiveMatchToD1(KEY, PAYLOAD);

    expect(dbMock.setMatchDataCache).toHaveBeenCalledTimes(1);
    expect(dbMock.setMatchDataCache).toHaveBeenCalledWith(
      KEY,
      PAYLOAD,
      expect.objectContaining({ keyType: "match", ct: 22, matchId: "26547", schemaVersion: 12 }),
    );
  });

  it("skips the write if the existing D1 row is younger than the throttle window", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    // 30s ago — well under default 120s throttle
    dbMock.getMatchDataCacheStoredAt.mockResolvedValue(
      new Date(Date.now() - 30_000).toISOString(),
    );

    await persistActiveMatchToD1(KEY, PAYLOAD);

    expect(dbMock.setMatchDataCache).not.toHaveBeenCalled();
  });

  it("writes when the existing row is older than the throttle window", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    // 5 min ago — way past default 120s throttle
    dbMock.getMatchDataCacheStoredAt.mockResolvedValue(
      new Date(Date.now() - 300_000).toISOString(),
    );
    dbMock.setMatchDataCache.mockResolvedValue(undefined);

    await persistActiveMatchToD1(KEY, PAYLOAD);

    expect(dbMock.setMatchDataCache).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit minAgeSeconds override", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    // 90s ago — under 120s default but over a 30s override
    dbMock.getMatchDataCacheStoredAt.mockResolvedValue(
      new Date(Date.now() - 90_000).toISOString(),
    );
    dbMock.setMatchDataCache.mockResolvedValue(undefined);

    await persistActiveMatchToD1(KEY, PAYLOAD, 30);

    expect(dbMock.setMatchDataCache).toHaveBeenCalledTimes(1);
  });

  it("ignores non-match cache keys", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");

    await persistActiveMatchToD1("computed:shooter:123:dashboard", PAYLOAD);

    expect(dbMock.getMatchDataCacheStoredAt).not.toHaveBeenCalled();
    expect(dbMock.setMatchDataCache).not.toHaveBeenCalled();
  });

  it("does not throw if the storedAt read fails — falls through to the write", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    dbMock.getMatchDataCacheStoredAt.mockRejectedValue(new Error("d1 down"));
    dbMock.setMatchDataCache.mockResolvedValue(undefined);

    await persistActiveMatchToD1(KEY, PAYLOAD);

    expect(dbMock.setMatchDataCache).toHaveBeenCalledTimes(1);
  });

  it("swallows D1 write errors", async () => {
    const { persistActiveMatchToD1 } = await import("@/lib/match-data-store");
    dbMock.getMatchDataCacheStoredAt.mockResolvedValue(null);
    dbMock.setMatchDataCache.mockRejectedValue(new Error("d1 down"));

    await expect(persistActiveMatchToD1(KEY, PAYLOAD)).resolves.toBeUndefined();
  });
});
