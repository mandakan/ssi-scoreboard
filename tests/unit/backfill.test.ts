import { describe, it, expect, vi } from "vitest";
import { runBackfill } from "@/lib/backfill";
import type { BackfillDeps } from "@/lib/backfill";
import { CACHE_SCHEMA_VERSION } from "@/lib/constants";

// Helper to encode a shooterId into a Relay Global ID
function encodeShooterId(id: number): string {
  return Buffer.from(`ShooterNode:${id}`).toString("base64");
}

function makeCacheEntry(
  event: {
    starts?: string | null;
    competitors?: Array<{
      id: string;
      first_name: string;
      last_name: string;
      club?: string | null;
      handgun_div?: string | null;
      get_handgun_div_display?: string | null;
      shooter?: { id: string } | null;
    }>;
  } | null,
  version: number = CACHE_SCHEMA_VERSION,
): string {
  return JSON.stringify({
    data: {
      event: event
        ? {
            starts: event.starts ?? "2025-06-01T08:00:00Z",
            competitors_approved_w_wo_results_not_dnf: event.competitors ?? [],
          }
        : null,
    },
    cachedAt: "2025-06-01T12:00:00Z",
    v: version,
  });
}

function createMockDeps(overrides: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    scanCachedMatchKeys: vi.fn().mockResolvedValue([]),
    getCachedMatch: vi.fn().mockResolvedValue(null),
    getExistingMatchRefs: vi.fn().mockResolvedValue(new Set<string>()),
    indexMatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runBackfill", () => {
  it("returns zero results when no cached matches exist", async () => {
    const deps = createMockDeps();
    const result = await runBackfill(deps, { shooterId: 100 });

    expect(result).toEqual({
      status: "complete",
      totalCached: 0,
      checked: 0,
      discovered: 0,
      alreadyIndexed: 0,
    });
  });

  it("skips already-indexed matches", async () => {
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"111"}',
        'gql:GetMatch:{"ct":22,"id":"222"}',
      ]),
      getExistingMatchRefs: vi.fn().mockResolvedValue(new Set(["22:111", "22:222"])),
    });

    const result = await runBackfill(deps, { shooterId: 100 });

    expect(result.alreadyIndexed).toBe(2);
    expect(result.checked).toBe(0);
    expect(result.discovered).toBe(0);
    expect(deps.getCachedMatch).not.toHaveBeenCalled();
  });

  it("discovers a shooter in unchecked cached matches", async () => {
    const shooterId = 41643;
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"999"}',
      ]),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry({
          starts: "2025-03-15T08:00:00Z",
          competitors: [
            {
              id: "50001",
              first_name: "John",
              last_name: "Doe",
              club: "IPSC Club",
              get_handgun_div_display: "Production",
              shooter: { id: encodeShooterId(shooterId) },
            },
          ],
        }),
      ),
    });

    const result = await runBackfill(deps, { shooterId });

    expect(result.discovered).toBe(1);
    expect(result.checked).toBe(1);
    expect(deps.indexMatch).toHaveBeenCalledWith({
      shooterId,
      ct: "22",
      matchId: "999",
      startTimestamp: Math.floor(new Date("2025-03-15T08:00:00Z").getTime() / 1000),
      competitor: {
        name: "John Doe",
        club: "IPSC Club",
        division: "Production",
        region: null,
        region_display: null,
        category: null,
        ics_alias: null,
        license: null,
      },
    });
  });

  it("skips entries with schema version below 6", async () => {
    const shooterId = 100;
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"888"}',
      ]),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry(
          {
            competitors: [
              {
                id: "1",
                first_name: "Jane",
                last_name: "Doe",
                shooter: { id: encodeShooterId(shooterId) },
              },
            ],
          },
          5,
        ),
      ),
    });

    const result = await runBackfill(deps, { shooterId });

    expect(result.checked).toBe(1);
    expect(result.discovered).toBe(0);
    expect(deps.indexMatch).not.toHaveBeenCalled();
  });

  it("accepts entries with schema version 6 or newer", async () => {
    const shooterId = 100;
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"888"}',
      ]),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry(
          {
            competitors: [
              {
                id: "1",
                first_name: "Jane",
                last_name: "Doe",
                shooter: { id: encodeShooterId(shooterId) },
              },
            ],
          },
          6,
        ),
      ),
    });

    const result = await runBackfill(deps, { shooterId });

    expect(result.checked).toBe(1);
    expect(result.discovered).toBe(1);
    expect(deps.indexMatch).toHaveBeenCalled();
  });

  it("calls onProgress after each batch", async () => {
    const shooterId = 41643;
    const keys = Array.from({ length: 5 }, (_, i) =>
      `gql:GetMatch:{"ct":22,"id":"${i}"}`,
    );

    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue(keys),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry({
          competitors: [
            {
              id: "1",
              first_name: "Test",
              last_name: "User",
              shooter: { id: encodeShooterId(shooterId) },
            },
          ],
        }),
      ),
    });

    const onProgress = vi.fn();
    await runBackfill(deps, { shooterId, batchSize: 2, onProgress });

    // Should be called: once after scanning, then once per batch (3 batches for 5 items with size 2)
    expect(onProgress).toHaveBeenCalled();
    // All progress calls should have status "scanning" or "checking"
    for (const call of onProgress.mock.calls) {
      expect(["scanning", "checking"]).toContain(call[0].status);
    }
  });

  it("respects batch size", async () => {
    const shooterId = 41643;
    const keys = Array.from({ length: 6 }, (_, i) =>
      `gql:GetMatch:{"ct":22,"id":"${i}"}`,
    );

    const getCachedMatch = vi.fn().mockResolvedValue(
      makeCacheEntry({
        competitors: [
          {
            id: "1",
            first_name: "Test",
            last_name: "User",
            shooter: { id: encodeShooterId(shooterId) },
          },
        ],
      }),
    );

    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue(keys),
      getCachedMatch,
    });

    const result = await runBackfill(deps, { shooterId, batchSize: 3 });

    expect(result.discovered).toBe(6);
    expect(getCachedMatch).toHaveBeenCalledTimes(6);
  });

  it("does not index when shooter is not in the competitor list", async () => {
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"777"}',
      ]),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry({
          competitors: [
            {
              id: "1",
              first_name: "Other",
              last_name: "Person",
              shooter: { id: encodeShooterId(99999) },
            },
          ],
        }),
      ),
    });

    const result = await runBackfill(deps, { shooterId: 41643 });

    expect(result.discovered).toBe(0);
    expect(result.checked).toBe(1);
    expect(deps.indexMatch).not.toHaveBeenCalled();
  });

  it("returns error when scan fails", async () => {
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockRejectedValue(new Error("Redis down")),
    });

    const result = await runBackfill(deps, { shooterId: 100 });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("Redis down");
  });

  it("handles competitors without shooter id", async () => {
    const deps = createMockDeps({
      scanCachedMatchKeys: vi.fn().mockResolvedValue([
        'gql:GetMatch:{"ct":22,"id":"555"}',
      ]),
      getCachedMatch: vi.fn().mockResolvedValue(
        makeCacheEntry({
          competitors: [
            {
              id: "1",
              first_name: "No",
              last_name: "Shooter",
              shooter: null,
            },
          ],
        }),
      ),
    });

    const result = await runBackfill(deps, { shooterId: 100 });

    expect(result.discovered).toBe(0);
    expect(deps.indexMatch).not.toHaveBeenCalled();
  });
});
