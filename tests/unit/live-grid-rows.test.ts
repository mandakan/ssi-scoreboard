import { describe, expect, it } from "vitest";
import { resolveGridRows } from "@/lib/live-grid-rows";
import type { CompetitorInfo, SquadInfo } from "@/lib/types";

const comp = (id: number, shooterId: number | null): CompetitorInfo => ({
  id,
  shooterId,
  name: `C${id}`,
  competitor_number: String(id),
  club: null,
  division: "Production",
  region: null,
  region_display: null,
  category: null,
  ics_alias: null,
  license: null,
});

const COMPETITORS = [comp(1, 500), comp(2, 501), comp(3, 502), comp(4, null)];
const SQUADS: SquadInfo[] = [
  { id: 90, number: 4, name: "Squad 4", competitorIds: [1, 2, 3] },
  { id: 91, number: 5, name: "Squad 5", competitorIds: [4] },
];

describe("resolveGridRows", () => {
  it("returns my squad-mates when source is squad", () => {
    expect(
      resolveGridRows({
        source: "squad",
        competitors: COMPETITORS,
        squads: SQUADS,
        myShooterId: 500,
        trackedShooterIds: new Set(),
        fallback: [],
      }),
    ).toEqual([1, 2, 3]);
  });

  it("falls back to the existing selection when I am in no squad", () => {
    expect(
      resolveGridRows({
        source: "squad",
        competitors: COMPETITORS,
        squads: SQUADS,
        myShooterId: 999,
        trackedShooterIds: new Set(),
        fallback: [2, 3],
      }),
    ).toEqual([2, 3]);
  });

  it("maps tracked shooter IDs to this match's competitor IDs", () => {
    expect(
      resolveGridRows({
        source: "tracked",
        competitors: COMPETITORS,
        squads: SQUADS,
        myShooterId: 500,
        trackedShooterIds: new Set([502]),
        fallback: [],
      }),
    ).toEqual([1, 3]);
  });

  it("drops tracked shooters who are not in this match", () => {
    expect(
      resolveGridRows({
        source: "tracked",
        competitors: COMPETITORS,
        squads: SQUADS,
        myShooterId: null,
        trackedShooterIds: new Set([501, 8888]),
        fallback: [],
      }),
    ).toEqual([2]);
  });

  it("never exceeds MAX_LIVE_GRID_ROWS", () => {
    const many = Array.from({ length: 30 }, (_, i) => comp(i + 1, i + 1));
    const squad: SquadInfo[] = [
      { id: 1, number: 1, name: "S1", competitorIds: many.map((c) => c.id) },
    ];
    expect(
      resolveGridRows({
        source: "squad",
        competitors: many,
        squads: squad,
        myShooterId: 1,
        trackedShooterIds: new Set(),
        fallback: [],
      }),
    ).toHaveLength(20);
  });

  it("puts me first so my row is the one already on screen", () => {
    const rows = resolveGridRows({
      source: "tracked",
      competitors: COMPETITORS,
      squads: SQUADS,
      myShooterId: 502,
      trackedShooterIds: new Set([500]),
      fallback: [],
    });
    expect(rows[0]).toBe(3);
  });

  it("ignores competitors with no shooterId when resolving tracked rows", () => {
    // Competitor 4 has shooterId null -- it must never match a tracked ID.
    expect(
      resolveGridRows({
        source: "tracked",
        competitors: COMPETITORS,
        squads: SQUADS,
        myShooterId: null,
        trackedShooterIds: new Set([500, 501]),
        fallback: [],
      }),
    ).toEqual([1, 2]);
  });
});
