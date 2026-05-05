import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the graphql module so we can stub `executeQuery` without touching the
// real upstream. The archive module imports STAGE_SCORECARDS_QUERY,
// gqlCacheKey, executeQuery, and cachedExecuteQuery — only executeQuery and
// cachedExecuteQuery need stubbing for the parallel-fan-out tests.
const executeQueryMock = vi.fn();

vi.mock("@/lib/graphql", async () => {
  const actual = await vi.importActual<typeof import("@/lib/graphql")>("@/lib/graphql");
  return {
    ...actual,
    executeQuery: (...args: Parameters<typeof actual.executeQuery>) =>
      executeQueryMock(...args),
  };
});

import {
  fetchWholeMatchArchive,
  type StageRef,
} from "@/lib/scorecards-archive";
import type { RawScCard } from "@/lib/scorecard-data";

beforeEach(() => {
  executeQueryMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeStageResponse(
  stageId: string,
  number: number,
  cards: Partial<RawScCard>[] = [],
) {
  return {
    stage: {
      id: stageId,
      number,
      name: `Stage ${number}`,
      max_points: 60,
      scorecards: cards.map((c, i) => ({
        created: "2026-05-04T08:00:00Z",
        points: 50,
        hitfactor: 5,
        time: 10,
        disqualified: false,
        zeroed: false,
        stage_not_fired: false,
        incomplete: false,
        ascore: 8,
        bscore: 0,
        cscore: 2,
        dscore: 0,
        miss: 0,
        penalty: 0,
        procedural: 0,
        competitor: { id: String(i + 1) },
        ...c,
      })),
    },
  };
}

describe("fetchWholeMatchArchive", () => {
  it("returns an empty stages array when given no stage refs (no upstream call)", async () => {
    const out = await fetchWholeMatchArchive([]);
    expect(out).toEqual({ event: { stages: [] } });
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  it("fans out one upstream call per stage with the per-stage (ct,id) pair", async () => {
    const refs: StageRef[] = [
      { ct: 24, id: "100" },
      { ct: 24, id: "101" },
      { ct: 24, id: "102" },
    ];
    executeQueryMock.mockImplementation((_q, vars) => {
      const stageId = vars.id as string;
      return Promise.resolve(makeStageResponse(stageId, parseInt(stageId, 10) - 99, [{}]));
    });

    await fetchWholeMatchArchive(refs);

    expect(executeQueryMock).toHaveBeenCalledTimes(3);
    const calledIds = executeQueryMock.mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(calledIds.sort()).toEqual(["100", "101", "102"]);
    // Confirm we always pass the IpscStageNode content_type, not the match's.
    for (const call of executeQueryMock.mock.calls) {
      expect((call[1] as { ct: number }).ct).toBe(24);
    }
  });

  it("reassembles per-stage responses into the legacy whole-match shape, sorted by stage number", async () => {
    // Pass in shuffled stage order — output should still be sorted ascending.
    const refs: StageRef[] = [
      { ct: 24, id: "300" },
      { ct: 24, id: "100" },
      { ct: 24, id: "200" },
    ];
    executeQueryMock.mockImplementation((_q, vars) => {
      const id = vars.id as string;
      const number = id === "100" ? 1 : id === "200" ? 2 : 3;
      return Promise.resolve(
        makeStageResponse(id, number, [{ competitor: { id: "1" } }, { competitor: { id: "2" } }]),
      );
    });

    const out = await fetchWholeMatchArchive(refs);

    expect(out.event?.stages).toBeDefined();
    expect(out.event!.stages!.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(out.event!.stages!.map((s) => s.id)).toEqual(["100", "200", "300"]);
    for (const stage of out.event!.stages!) {
      expect(stage.scorecards).toHaveLength(2);
      expect(stage.max_points).toBe(60);
    }
  });

  it("preserves null max_points and empty scorecards arrays from upstream", async () => {
    executeQueryMock.mockResolvedValueOnce({
      stage: {
        id: "100",
        number: 1,
        name: "Stage 1",
        max_points: null,
        scorecards: undefined,
      },
    });
    const out = await fetchWholeMatchArchive([{ ct: 24, id: "100" }]);
    expect(out.event!.stages![0].max_points).toBeNull();
    expect(out.event!.stages![0].scorecards).toEqual([]);
  });

  it("filters out null stage responses (e.g. permission errors on a single stage)", async () => {
    executeQueryMock
      .mockResolvedValueOnce(makeStageResponse("100", 1, [{}]))
      .mockResolvedValueOnce({ stage: null })
      .mockResolvedValueOnce(makeStageResponse("102", 3, [{}]));
    const out = await fetchWholeMatchArchive([
      { ct: 24, id: "100" },
      { ct: 24, id: "101" },
      { ct: 24, id: "102" },
    ]);
    expect(out.event!.stages!.map((s) => s.id)).toEqual(["100", "102"]);
  });

  it("respects the concurrency cap (≤ 4 in flight at a time)", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    executeQueryMock.mockImplementation(async (_q, vars) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Yield twice so concurrency can build up.
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
      return makeStageResponse(vars.id as string, parseInt(vars.id as string, 10), [{}]);
    });

    // 10 stages → if concurrency cap works, peak in-flight should be ≤ 4.
    const refs: StageRef[] = Array.from({ length: 10 }, (_, i) => ({
      ct: 24,
      id: String(i + 1),
    }));
    await fetchWholeMatchArchive(refs);

    expect(peakInFlight).toBeLessThanOrEqual(4);
    expect(executeQueryMock).toHaveBeenCalledTimes(10);
  });

  it("propagates a single-stage upstream failure as a rejection (caller decides fallback)", async () => {
    executeQueryMock
      .mockResolvedValueOnce(makeStageResponse("100", 1, [{}]))
      .mockRejectedValueOnce(new Error("Upstream 500"));
    await expect(
      fetchWholeMatchArchive([
        { ct: 24, id: "100" },
        { ct: 24, id: "101" },
      ]),
    ).rejects.toThrow("Upstream 500");
  });
});
