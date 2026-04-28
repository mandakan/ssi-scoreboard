import { describe, it, expect } from "vitest";
import { mergeScorecardDelta } from "@/lib/scorecard-merge";
import type { RawScorecardsData } from "@/lib/scorecard-data";
import type { ScorecardDeltaEntry } from "@/lib/graphql";

function competitor(id: string) {
  return { id, first_name: `F${id}`, last_name: `L${id}` };
}

function cachedFixture(): RawScorecardsData {
  return {
    event: {
      stages: [
        {
          id: "100",
          number: 1,
          name: "Stage 1",
          max_points: 80,
          scorecards: [
            { points: 60, hitfactor: 4.5, competitor: competitor("c1") },
            { points: 50, hitfactor: 3.8, competitor: competitor("c2") },
          ],
        },
        {
          id: "101",
          number: 2,
          name: "Stage 2",
          max_points: 100,
          scorecards: [
            { points: 90, hitfactor: 5.5, competitor: competitor("c1") },
          ],
        },
      ],
    },
  };
}

describe("mergeScorecardDelta", () => {
  it("replaces an existing scorecard by (stage, competitor) and counts as updated", () => {
    const cached = cachedFixture();
    const delta: ScorecardDeltaEntry[] = [
      {
        stage: { id: "100" },
        points: 75,
        hitfactor: 5.2,
        competitor: { id: "c1", first_name: "F1", last_name: "L1" },
      },
    ];

    const result = mergeScorecardDelta(cached, delta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(0);
    const stage = result.data.event!.stages![0];
    const c1 = stage.scorecards!.find((s) => s.competitor?.id === "c1");
    expect(c1?.points).toBe(75);
    expect(c1?.hitfactor).toBe(5.2);
    // Other competitor untouched
    expect(stage.scorecards!.find((s) => s.competitor?.id === "c2")?.points).toBe(50);
  });

  it("appends a brand-new (stage, competitor) scorecard and counts as added", () => {
    const cached = cachedFixture();
    const delta: ScorecardDeltaEntry[] = [
      {
        stage: { id: "100" },
        points: 70,
        hitfactor: 4.0,
        competitor: { id: "c3", first_name: "F3", last_name: "L3" },
      },
    ];

    const result = mergeScorecardDelta(cached, delta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.updatedCount).toBe(0);
    expect(result.addedCount).toBe(1);
    const stage = result.data.event!.stages![0];
    expect(stage.scorecards!.length).toBe(3);
    expect(stage.scorecards!.some((s) => s.competitor?.id === "c3")).toBe(true);
  });

  it("does not mutate the cached input", () => {
    const cached = cachedFixture();
    const before = JSON.stringify(cached);
    mergeScorecardDelta(cached, [
      {
        stage: { id: "100" },
        points: 1,
        competitor: { id: "c1" },
      },
    ]);
    expect(JSON.stringify(cached)).toBe(before);
  });

  it("fails with stage-missing when delta references an unknown stage (e.g. new stage added upstream)", () => {
    const cached = cachedFixture();
    const delta: ScorecardDeltaEntry[] = [
      {
        stage: { id: "999" }, // not in cached snapshot
        points: 70,
        competitor: { id: "c1" },
      },
    ];

    const result = mergeScorecardDelta(cached, delta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stage-missing");
  });

  it("fails with competitor-missing on malformed delta", () => {
    const cached = cachedFixture();
    const delta: ScorecardDeltaEntry[] = [
      {
        stage: { id: "100" },
        points: 70,
        competitor: null,
      },
    ];

    const result = mergeScorecardDelta(cached, delta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("competitor-missing");
  });

  it("fails with no-event when cached entry has no event payload", () => {
    const result = mergeScorecardDelta({ event: null }, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no-event");
  });

  it("fails with stages-missing when cached entry has no stages array", () => {
    const result = mergeScorecardDelta({ event: { stages: undefined } }, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stages-missing");
  });

  it("merges a mixed batch (replaces some, appends others, across stages)", () => {
    const cached = cachedFixture();
    const delta: ScorecardDeltaEntry[] = [
      // Replace c1 on stage 100
      { stage: { id: "100" }, points: 78, competitor: { id: "c1" } },
      // Append c2 on stage 101 (only c1 was there before)
      { stage: { id: "101" }, points: 85, competitor: { id: "c2" } },
      // Append brand-new c3 on stage 100
      { stage: { id: "100" }, points: 60, competitor: { id: "c3" } },
    ];

    const result = mergeScorecardDelta(cached, delta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.updatedCount).toBe(1);
    expect(result.addedCount).toBe(2);
    const s100 = result.data.event!.stages!.find((s) => s.id === "100")!;
    const s101 = result.data.event!.stages!.find((s) => s.id === "101")!;
    expect(s100.scorecards!.length).toBe(3); // c1, c2, c3
    expect(s101.scorecards!.length).toBe(2); // c1, c2
    expect(s100.scorecards!.find((s) => s.competitor?.id === "c1")?.points).toBe(78);
  });

  it("returns empty counts on empty delta", () => {
    const result = mergeScorecardDelta(cachedFixture(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedCount).toBe(0);
    expect(result.addedCount).toBe(0);
  });
});
