import { describe, expect, it } from "vitest";
import { buildLiveGridCells, computeLiveEdgeStageId } from "@/lib/live-grid";
import type { RawScorecard } from "@/app/api/compare/logic";
import type { LiveGridStage } from "@/lib/types";

function card(over: Partial<RawScorecard> = {}): RawScorecard {
  return {
    competitor_id: 1,
    competitor_division: "Production",
    stage_id: 10,
    stage_number: 1,
    stage_name: "Cold Start",
    max_points: 60,
    points: 55,
    hit_factor: 5.5,
    time: 10,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 10,
    c_hits: 2,
    d_hits: 0,
    miss_count: 0,
    no_shoots: 0,
    procedurals: 0,
    scorecard_created: "2026-08-23T09:00:00Z",
    ...over,
  };
}

const STAGES: LiveGridStage[] = [
  { stage_id: 10, stage_num: 1, name: "Cold Start", max_points: 60 },
  { stage_id: 11, stage_num: 2, name: "Doubles", max_points: 40 },
];

describe("buildLiveGridCells", () => {
  it("keys cells by competitor then stage", () => {
    const cells = buildLiveGridCells([card()], [1]);
    expect(cells[1][10].hf).toBe(5.5);
    expect(cells[1][10].status).toBe("scored");
  });

  it("ignores competitors that were not requested", () => {
    const cells = buildLiveGridCells([card(), card({ competitor_id: 99 })], [1]);
    expect(cells[99]).toBeUndefined();
  });

  it("maps no_shoots to ns and keeps B+C folded in c", () => {
    const cells = buildLiveGridCells([card({ no_shoots: 2, c_hits: 3 })], [1]);
    expect(cells[1][10].ns).toBe(2);
    expect(cells[1][10].c).toBe(3);
  });

  it("classifies dq, zeroed, not_fired and incomplete ahead of scored", () => {
    const s = (o: Partial<RawScorecard>) =>
      buildLiveGridCells([card(o)], [1])[1][10].status;
    expect(s({ dq: true })).toBe("dq");
    expect(s({ zeroed: true })).toBe("zeroed");
    expect(s({ dnf: true })).toBe("not_fired");
    expect(s({ incomplete: true })).toBe("incomplete");
  });

  it("prefers dq over every other flag", () => {
    const cells = buildLiveGridCells(
      [card({ dq: true, zeroed: true, dnf: true })],
      [1],
    );
    expect(cells[1][10].status).toBe("dq");
  });

  it("returns an empty map for a competitor with no cards", () => {
    expect(buildLiveGridCells([], [1])).toEqual({ 1: {} });
  });
});

describe("computeLiveEdgeStageId", () => {
  it("picks the stage holding the newest scorecard", () => {
    const cells = buildLiveGridCells(
      [
        card({ stage_id: 10, scorecard_created: "2026-08-23T09:00:00Z" }),
        card({
          stage_id: 11,
          stage_number: 2,
          scorecard_created: "2026-08-23T11:00:00Z",
        }),
      ],
      [1],
    );
    expect(computeLiveEdgeStageId(cells, STAGES)).toBe(11);
  });

  it("returns the first stage when nothing has been scored", () => {
    expect(computeLiveEdgeStageId({ 1: {} }, STAGES)).toBe(10);
  });

  it("returns null when there are no stages", () => {
    expect(computeLiveEdgeStageId({}, [])).toBeNull();
  });
});
