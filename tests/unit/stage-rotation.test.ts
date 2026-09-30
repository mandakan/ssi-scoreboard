import { describe, expect, it } from "vitest";
import { squadForShooter, squadRotation, stageIndexForRound } from "@/lib/stage-rotation";
import type { MatchResponse } from "@/lib/types";

const stages = [3, 1, 2].map((n) => ({ id: n * 10, stage_number: n }));

describe("stage rotation", () => {
  it("round-robins from the squad's own stage", () => {
    expect(stageIndexForRound(1, 1, 3)).toBe(0);
    expect(stageIndexForRound(2, 1, 3)).toBe(1);
    expect(stageIndexForRound(3, 2, 3)).toBe(0);
  });
  it("orders a squad's rotation by stage number", () => {
    expect(squadRotation(2, stages).map((r) => r.stage.stage_number)).toEqual([2, 3, 1]);
    expect(squadRotation(2, stages).map((r) => r.round)).toEqual([1, 2, 3]);
  });
  it("is empty without stages", () => {
    expect(squadRotation(1, [])).toEqual([]);
  });
  it("finds the shooter's squad", () => {
    const match = {
      competitors: [{ id: 5, shooterId: 900 }, { id: 6, shooterId: null }],
      squads: [{ id: 1, number: 4, name: "Squad 4", competitorIds: [5, 6] }],
    } as unknown as MatchResponse;
    expect(squadForShooter(match, 900)?.number).toBe(4);
    expect(squadForShooter(match, 1)).toBeNull();
    expect(squadForShooter(match, null)).toBeNull();
  });
});
