import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  searchMatches: vi.fn<(q: string, limit?: number) => Promise<Array<{ ct: number; matchId: string }>>>(),
}));
vi.mock("@/lib/db-impl", () => ({ default: dbMock }));

const storeMock = vi.hoisted(() => ({
  getMatchDataWithFallback: vi.fn<(key: string) => Promise<string | null>>(),
}));
vi.mock("@/lib/match-data-store", () => storeMock);

import {
  cachedMatchEventToRawEvent,
  searchLocalEvents,
} from "@/lib/local-event-search";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

const FULL_EVENT = {
  name: "SPSK Open 2026",
  venue: "Sundsvall",
  starts: "2026-08-01T09:00:00+02:00",
  ends: "2026-08-02T17:00:00+02:00",
  status: "cp",
  region: "SWE",
  level: 3,
  get_full_rule_display: "IPSC Handgun",
  visibility: "pub",
  get_visibility_display: "Public, searchable",
  registration: "cl",
  is_registration_possible: false,
  is_squadding_possible: false,
  max_competitors: 200,
};

function entryFor(event: unknown, v = CACHE_SCHEMA_VERSION) {
  return JSON.stringify({ data: { event }, cachedAt: "2026-08-10T00:00:00Z", v });
}

beforeEach(() => {
  dbMock.searchMatches.mockReset();
  storeMock.getMatchDataWithFallback.mockReset();
});

describe("cachedMatchEventToRawEvent", () => {
  it("maps a complete public event, deriving the level display from the code", () => {
    const raw = cachedMatchEventToRawEvent(22, "27190", FULL_EVENT);
    expect(raw).not.toBeNull();
    expect(raw!.id).toBe("27190");
    expect(raw!.get_content_type_key).toBe(22);
    expect(raw!.get_full_level_display).toBe("Level III");
    expect(raw!.ends).toBe(FULL_EVENT.ends);
  });

  it("drops non-public matches (never surface club/unlisted from local search)", () => {
    expect(cachedMatchEventToRawEvent(22, "1", { ...FULL_EVENT, visibility: "clb" })).toBeNull();
    expect(cachedMatchEventToRawEvent(22, "1", { ...FULL_EVENT, visibility: undefined })).toBeNull();
  });

  it("drops incomplete events instead of serving partial shapes", () => {
    expect(cachedMatchEventToRawEvent(22, "1", { ...FULL_EVENT, name: undefined })).toBeNull();
    expect(cachedMatchEventToRawEvent(22, "1", { ...FULL_EVENT, starts: undefined })).toBeNull();
    expect(cachedMatchEventToRawEvent(22, "1", { ...FULL_EVENT, level: 9 })).toBeNull();
  });
});

describe("searchLocalEvents", () => {
  it("returns hydrated public hits from the cached blobs", async () => {
    dbMock.searchMatches.mockResolvedValue([{ ct: 22, matchId: "27190" }]);
    storeMock.getMatchDataWithFallback.mockResolvedValue(entryFor(FULL_EVENT));
    const out = await searchLocalEvents("spsk");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("SPSK Open 2026");
  });

  it("drops hits whose blob is missing or version-stale (caller falls through)", async () => {
    dbMock.searchMatches.mockResolvedValue([
      { ct: 22, matchId: "1" },
      { ct: 22, matchId: "2" },
    ]);
    storeMock.getMatchDataWithFallback
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(entryFor(FULL_EVENT, CACHE_SCHEMA_VERSION - 1));
    expect(await searchLocalEvents("x")).toEqual([]);
  });

  it("returns empty on db errors (upstream fallback, never a user error)", async () => {
    dbMock.searchMatches.mockRejectedValue(new Error("d1 down"));
    expect(await searchLocalEvents("x")).toEqual([]);
  });
});
