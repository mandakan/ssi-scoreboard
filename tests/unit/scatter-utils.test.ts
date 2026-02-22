import { describe, it, expect } from "vitest";
import { computeIsoHfLines, buildScatterData } from "@/lib/scatter-utils";
import type { StageComparison, CompetitorInfo } from "@/lib/types";

// --------------------------------------------------------------------------
// computeIsoHfLines
// --------------------------------------------------------------------------

describe("computeIsoHfLines", () => {
  it("returns empty array when maxTime is 0", () => {
    expect(computeIsoHfLines(0, 100)).toEqual([]);
  });

  it("returns empty array when maxPoints is 0", () => {
    expect(computeIsoHfLines(30, 0)).toEqual([]);
  });

  it("all lines start from the origin (0, 0)", () => {
    const lines = computeIsoHfLines(30, 120);
    for (const line of lines) {
      expect(line.x1).toBe(0);
      expect(line.y1).toBe(0);
    }
  });

  it("uses default hf values [2, 4, 6, 8]", () => {
    const lines = computeIsoHfLines(30, 120);
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.hf)).toEqual([2, 4, 6, 8]);
  });

  it("clips to right edge when hf * maxTime <= maxPoints", () => {
    // HF=2, maxTime=20, maxPoints=100: 2*20=40 <= 100 → right edge
    const [line] = computeIsoHfLines(20, 100, [2]);
    expect(line.x2).toBe(20);
    expect(line.y2).toBeCloseTo(40);
  });

  it("clips to top edge when hf * maxTime > maxPoints", () => {
    // HF=8, maxTime=20, maxPoints=100: 8*20=160 > 100 → top edge
    const [line] = computeIsoHfLines(20, 100, [8]);
    expect(line.x2).toBeCloseTo(100 / 8);
    expect(line.y2).toBe(100);
  });

  it("clips to top edge exactly when hf * maxTime == maxPoints", () => {
    // HF=5, maxTime=20, maxPoints=100: 5*20=100 → should clip at top (x2=20=100/5)
    const [line] = computeIsoHfLines(20, 100, [5]);
    expect(line.x2).toBeCloseTo(20);
    expect(line.y2).toBeCloseTo(100);
  });

  it("respects custom hf values", () => {
    const lines = computeIsoHfLines(30, 120, [1, 3, 5]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.hf)).toEqual([1, 3, 5]);
  });

  it("endpoint satisfies y2 = hf * x2", () => {
    const lines = computeIsoHfLines(25, 150, [2, 4, 6, 8, 10]);
    for (const line of lines) {
      expect(line.y2).toBeCloseTo(line.hf * line.x2);
    }
  });
});

// --------------------------------------------------------------------------
// buildScatterData
// --------------------------------------------------------------------------

const aliceInfo: CompetitorInfo = {
  id: 1,
  name: "Alice Smith",
  competitor_number: "10",
  club: null,
  division: "Open",
};

const bobInfo: CompetitorInfo = {
  id: 2,
  name: "Bob Jones",
  competitor_number: "20",
  club: null,
  division: "Production",
};

interface StageOverrides {
  dq?: boolean;
  zeroed?: boolean;
  dnf?: boolean;
  time?: number | null;
  points?: number | null;
  hit_factor?: number | null;
}

function makeStage(overrides: StageOverrides = {}): StageComparison {
  return {
    stage_id: 1,
    stage_name: "Stage One",
    stage_num: 1,
    max_points: 100,
    group_leader_hf: 5.0,
    group_leader_points: 80,
    overall_leader_hf: 5.0,
    competitors: {
      1: {
        competitor_id: 1,
        points: overrides.points !== undefined ? overrides.points : 80,
        hit_factor:
          overrides.hit_factor !== undefined ? overrides.hit_factor : 4.0,
        time: overrides.time !== undefined ? overrides.time : 20,
        group_rank: 1,
        group_percent: 100,
        div_rank: 1,
        div_percent: 100,
        overall_rank: 1,
        overall_percent: 100,
        dq: overrides.dq ?? false,
        zeroed: overrides.zeroed ?? false,
        dnf: overrides.dnf ?? false,
        a_hits: null,
        c_hits: null,
        d_hits: null,
        miss_count: null,
        no_shoots: null,
        procedurals: null,
      },
    },
  };
}

describe("buildScatterData", () => {
  it("includes valid stage results", () => {
    const result = buildScatterData([makeStage()], [aliceInfo]);
    expect(result[1]).toHaveLength(1);
    expect(result[1][0]).toMatchObject({
      time: 20,
      points: 80,
      hitFactor: 4.0,
      competitorId: 1,
      competitorName: "Alice Smith",
      stageName: "Stage One",
      stageNum: 1,
    });
  });

  it("excludes DNF stages", () => {
    expect(
      buildScatterData([makeStage({ dnf: true })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes zeroed stages", () => {
    expect(
      buildScatterData([makeStage({ zeroed: true })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes DQ stages", () => {
    expect(
      buildScatterData([makeStage({ dq: true })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes stages with null time", () => {
    expect(
      buildScatterData([makeStage({ time: null })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes stages with time = 0", () => {
    expect(
      buildScatterData([makeStage({ time: 0 })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes stages with null points", () => {
    expect(
      buildScatterData([makeStage({ points: null })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("excludes stages with null hit_factor", () => {
    expect(
      buildScatterData([makeStage({ hit_factor: null })], [aliceInfo])[1],
    ).toHaveLength(0);
  });

  it("returns an empty array for each competitor when no valid stages exist", () => {
    const result = buildScatterData(
      [makeStage({ dnf: true })],
      [aliceInfo, bobInfo],
    );
    expect(result[1]).toHaveLength(0);
    expect(result[2]).toHaveLength(0);
  });

  it("groups data correctly per competitor across multiple stages", () => {
    const stage2: StageComparison = {
      stage_id: 2,
      stage_name: "Stage Two",
      stage_num: 2,
      max_points: 120,
      group_leader_hf: 6.0,
      group_leader_points: 100,
      overall_leader_hf: 6.0,
      competitors: {
        1: {
          competitor_id: 1,
          points: 90,
          hit_factor: 5.0,
          time: 18,
          group_rank: 1,
          group_percent: 100,
          div_rank: 1,
          div_percent: 100,
          overall_rank: 1,
          overall_percent: 100,
          dq: false,
          zeroed: false,
          dnf: false,
          a_hits: null,
          c_hits: null,
          d_hits: null,
          miss_count: null,
          no_shoots: null,
          procedurals: null,
        },
        2: {
          competitor_id: 2,
          points: 70,
          hit_factor: 3.5,
          time: 20,
          group_rank: 2,
          group_percent: 58.3,
          div_rank: 1,
          div_percent: 100,
          overall_rank: 2,
          overall_percent: 58.3,
          dq: false,
          zeroed: false,
          dnf: false,
          a_hits: null,
          c_hits: null,
          d_hits: null,
          miss_count: null,
          no_shoots: null,
          procedurals: null,
        },
      },
    };
    const result = buildScatterData([makeStage(), stage2], [aliceInfo, bobInfo]);
    // Alice has data from both stages; Bob only has data from stage2
    expect(result[1]).toHaveLength(2);
    expect(result[2]).toHaveLength(1);
    expect(result[2][0].points).toBe(70);
  });
});
