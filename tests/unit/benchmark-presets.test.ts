import { describe, it, expect } from "vitest";
import {
  computeSmartPresets,
  rankAtPercentile,
} from "@/lib/benchmark-presets";
import type { CompetitorInfo, FieldFingerprintPoint } from "@/lib/types";

function comp(
  id: number,
  name: string,
  opts: { club?: string | null; shooterId?: number | null } = {},
): CompetitorInfo {
  return {
    id,
    shooterId: opts.shooterId ?? id + 1000,
    name,
    competitor_number: String(id),
    club: opts.club ?? null,
    division: "Production",
    region: null,
    region_display: null,
    category: null,
    ics_alias: null,
    license: null,
  };
}

function point(id: number, division: string, rank: number): FieldFingerprintPoint {
  return {
    competitorId: id,
    division,
    alphaRatio: 0.6,
    pointsPerSecond: 5,
    penaltyRate: 0,
    accuracyPercentile: 50,
    speedPercentile: 50,
    cv: null,
    actualDivRank: rank,
    actualOverallRank: rank,
  };
}

describe("rankAtPercentile", () => {
  it("returns top rank for p100 and bottom rank for p0", () => {
    expect(rankAtPercentile(100, 10)).toBe(1);
    expect(rankAtPercentile(0, 10)).toBe(10);
  });

  it("returns approximate median for p50", () => {
    expect(rankAtPercentile(50, 10)).toBe(6); // round(0.5 * 9) + 1
    expect(rankAtPercentile(50, 100)).toBe(51);
  });

  it("clamps to [1, n]", () => {
    expect(rankAtPercentile(120, 5)).toBe(1);
    expect(rankAtPercentile(-10, 5)).toBe(5);
  });

  it("handles n=1 without dividing by zero", () => {
    expect(rankAtPercentile(50, 1)).toBe(1);
  });

  it("handles n=0 by returning 1 (helper guards downstream)", () => {
    expect(rankAtPercentile(50, 0)).toBe(1);
  });
});

describe("computeSmartPresets", () => {
  const me = comp(10, "Mathias Axell", { club: "BSF" });
  const myPoint = point(10, "Production", 5);

  it("returns no presets when myPoint has no division", () => {
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, division: null },
      competitors: [me],
      fieldFingerprintPoints: [{ ...myPoint, division: null }],
    });
    expect(result).toEqual([]);
  });

  it("includes one-above and one-below in the middle of a division", () => {
    const competitors = Array.from({ length: 10 }, (_, i) =>
      comp(i + 1, `Shooter ${i + 1}`),
    ).concat(me);
    const points = competitors.map((c, i) =>
      point(c.id, "Production", c.id === me.id ? 5 : i + 1 >= 5 ? i + 2 : i + 1),
    );

    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint,
      competitors,
      fieldFingerprintPoints: points,
    });

    const above = result.find((p) => p.kind === "one-above");
    const below = result.find((p) => p.kind === "one-below");
    expect(above).toBeDefined();
    expect(below).toBeDefined();
    expect(above!.ids[0]).toBe(me.id);
    expect(above!.ids).toHaveLength(2);
    expect(below!.ids[0]).toBe(me.id);
    expect(below!.ids).toHaveLength(2);
  });

  it("omits one-above when I'm at rank 1", () => {
    const others = [comp(2, "B"), comp(3, "C"), comp(4, "D")];
    const competitors = [me, ...others];
    const points = [
      point(me.id, "Production", 1),
      point(2, "Production", 2),
      point(3, "Production", 3),
      point(4, "Production", 4),
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    expect(result.find((p) => p.kind === "one-above")).toBeUndefined();
    expect(result.find((p) => p.kind === "one-below")).toBeDefined();
  });

  it("omits one-below when I'm at the last rank", () => {
    const others = [comp(2, "B"), comp(3, "C"), comp(4, "D")];
    const competitors = [me, ...others];
    const points = [
      point(2, "Production", 1),
      point(3, "Production", 2),
      point(4, "Production", 3),
      point(me.id, "Production", 4),
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 4 },
      competitors,
      fieldFingerprintPoints: points,
    });
    expect(result.find((p) => p.kind === "one-above")).toBeDefined();
    expect(result.find((p) => p.kind === "one-below")).toBeUndefined();
  });

  it("podium dedupes when I am in the top 3", () => {
    const others = [comp(2, "B"), comp(3, "C"), comp(4, "D")];
    const competitors = [me, ...others];
    const points = [
      point(me.id, "Production", 1),
      point(2, "Production", 2),
      point(3, "Production", 3),
      point(4, "Production", 4),
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    const podium = result.find((p) => p.kind === "podium");
    expect(podium).toBeDefined();
    // [me, 2, 3] — me is included once even though me is also in top 3
    expect(podium!.ids).toEqual([me.id, 2, 3]);
  });

  it("percentile cohort needs at least 4 ranked competitors", () => {
    const others = [comp(2, "B"), comp(3, "C")];
    const competitors = [me, ...others];
    const points = [
      point(me.id, "Production", 1),
      point(2, "Production", 2),
      point(3, "Production", 3),
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    expect(result.find((p) => p.kind === "percentile")).toBeUndefined();
  });

  it("percentile cohort picks p25/p50/p75/p95 plus me", () => {
    const competitors: CompetitorInfo[] = [me];
    const points: FieldFingerprintPoint[] = [point(me.id, "Production", 5)];
    for (let r = 1; r <= 20; r++) {
      if (r === 5) continue;
      const id = 100 + r;
      competitors.push(comp(id, `R${r}`));
      points.push(point(id, "Production", r));
    }
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint,
      competitors,
      fieldFingerprintPoints: points,
    });
    const cohort = result.find((p) => p.kind === "percentile");
    expect(cohort).toBeDefined();
    // me is always first; cohort length 2..5 depending on dedup with rank 5.
    expect(cohort!.ids[0]).toBe(me.id);
    expect(cohort!.ids.length).toBeGreaterThanOrEqual(3);
    expect(cohort!.ids.length).toBeLessThanOrEqual(5);
  });

  it("includes same-club only when peers exist with the same club", () => {
    const peers = [
      comp(2, "Peer 1", { club: "BSF" }),
      comp(3, "Peer 2", { club: "BSF" }),
    ];
    const others = [comp(4, "Other", { club: "Other" })];
    const competitors = [me, ...peers, ...others];
    const points = [
      point(me.id, "Production", 1),
      point(2, "Production", 2),
      point(3, "Production", 3),
      point(4, "Production", 4),
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    const club = result.find((p) => p.kind === "same-club");
    expect(club).toBeDefined();
    expect(club!.ids).toEqual([me.id, 2, 3]);
  });

  it("omits same-club when my club is null", () => {
    const meNoClub = { ...me, club: null };
    const others = [comp(2, "B", { club: "BSF" })];
    const competitors = [meNoClub, ...others];
    const points = [
      point(meNoClub.id, "Production", 1),
      point(2, "Production", 2),
    ];
    const result = computeSmartPresets({
      myCompetitor: meNoClub,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    expect(result.find((p) => p.kind === "same-club")).toBeUndefined();
  });

  it("respects MAX_COMPETITORS for very large clubs", () => {
    const peers = Array.from({ length: 30 }, (_, i) =>
      comp(i + 100, `Peer ${i}`, { club: "BSF" }),
    );
    const competitors = [me, ...peers];
    const points = competitors.map((c, i) =>
      point(c.id, "Production", i + 1),
    );
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    const club = result.find((p) => p.kind === "same-club")!;
    // MAX_COMPETITORS = 12
    expect(club.ids.length).toBe(12);
    expect(club.ids[0]).toBe(me.id);
  });

  it("ignores points from other divisions", () => {
    const others = [
      comp(2, "Same", { club: null }),
      comp(3, "Other-div", { club: null }),
    ];
    const competitors = [me, ...others];
    const points = [
      point(me.id, "Production", 1),
      point(2, "Production", 2),
      point(3, "Open", 1), // different division — must be ignored
    ];
    const result = computeSmartPresets({
      myCompetitor: me,
      myPoint: { ...myPoint, actualDivRank: 1 },
      competitors,
      fieldFingerprintPoints: points,
    });
    const podium = result.find((p) => p.kind === "podium");
    expect(podium!.ids).toEqual([me.id, 2]);
  });
});
