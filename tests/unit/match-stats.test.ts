import { describe, it, expect } from "vitest";
import { computeMatchStats } from "@/lib/match-stats";
import type { RawScorecard } from "@/app/api/compare/logic";

function card(overrides: Partial<RawScorecard> = {}): RawScorecard {
  return {
    competitor_id: 1,
    competitor_division: "Production Optics",
    stage_id: 1,
    stage_number: 1,
    stage_name: "Stage 1",
    max_points: 50,
    points: 50,
    hit_factor: 5,
    time: 10,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: 10,
    c_hits: 0,
    d_hits: 0,
    miss_count: 0,
    no_shoots: 0,
    procedurals: 0,
    ...overrides,
  };
}

describe("computeMatchStats — matchPct (IPSC points formula)", () => {
  it("returns 100% when the shooter is the division leader on every stage", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 50 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 6, max_points: 100 }),
      // Slower competitor in same division
      card({ competitor_id: 2, stage_id: 1, hit_factor: 4, max_points: 50, a_hits: 8 }),
      card({ competitor_id: 2, stage_id: 2, hit_factor: 3, max_points: 100, a_hits: 8 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.matchPct).toBeCloseTo(100, 4);
  });

  it("weights stages by max_points (longer stages count more)", () => {
    // Shooter A scores 100% on a 25-pt stage and 50% on a 100-pt stage.
    //
    // Averaged-pct formula:    (100 + 50) / 2 = 75%
    // IPSC points formula:     (1.0×25 + 0.5×100) / (1.0×25 + 1.0×100)
    //                        = 75 / 125 = 60%
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 25 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 3, max_points: 100 }),
      // Division leader: 100% on every stage
      card({ competitor_id: 2, stage_id: 1, hit_factor: 5, max_points: 25 }),
      card({ competitor_id: 2, stage_id: 2, hit_factor: 6, max_points: 100 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.matchPct).toBeCloseTo(60, 2);
  });

  it("ignores other divisions when picking the leader", () => {
    const cards: RawScorecard[] = [
      // Our shooter (Production Optics)
      card({ competitor_id: 1, stage_id: 1, hit_factor: 4, max_points: 50 }),
      // Higher HF in DIFFERENT division — must be ignored
      card({
        competitor_id: 99,
        competitor_division: "Open",
        stage_id: 1,
        hit_factor: 10,
        max_points: 50,
      }),
      // Same-division competitor (lower HF)
      card({ competitor_id: 2, stage_id: 1, hit_factor: 4, max_points: 50 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.matchPct).toBeCloseTo(100, 4);
  });

  it("excludes DQ'd competitors from the division leader pool", () => {
    const cards: RawScorecard[] = [
      // Our shooter
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 50 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 5, max_points: 50 }),
      // Faster shooter who DQ'd on stage 2 — their match total must not anchor 100%
      card({ competitor_id: 2, stage_id: 1, hit_factor: 10, max_points: 50 }),
      card({ competitor_id: 2, stage_id: 2, hit_factor: 0, max_points: 50, dq: true }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    // Without DQ exclusion: leader_pts = 50 (10/10 ×50) + 0 = 50, my_pts = 50 → 100%
    // With DQ exclusion: comp 2 ignored → my shooter is the only valid total → 100%
    // To distinguish, add a third clean shooter who is faster on stage 1 only.
    expect(s.matchPct).toBeCloseTo(100, 4);

    const cards2: RawScorecard[] = [
      ...cards,
      // Clean shooter who is the actual division leader
      card({ competitor_id: 3, stage_id: 1, hit_factor: 8, max_points: 50 }),
      card({ competitor_id: 3, stage_id: 2, hit_factor: 8, max_points: 50 }),
    ];
    const s2 = computeMatchStats(1, "Production Optics", cards2);
    // shooter 1: 5/8×50 + 5/8×50 = 31.25 + 31.25 = 62.5
    // shooter 3 (leader): 8/8×50 + 8/8×50 = 100
    // pct = 62.5 / 100 = 62.5%
    expect(s2.matchPct).toBeCloseTo(62.5, 4);
  });

  it("treats DNF / zeroed stages as 0 points but still rates the shooter", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 50 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 0, max_points: 50, dnf: true }),
      // Division leader: clean run on both
      card({ competitor_id: 2, stage_id: 1, hit_factor: 5, max_points: 50 }),
      card({ competitor_id: 2, stage_id: 2, hit_factor: 5, max_points: 50 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    // leader = 100 pts, mine = 50 pts → 50%
    expect(s.matchPct).toBeCloseTo(50, 4);
    expect(s.stageCount).toBe(1); // DNF stage excluded from valid count
  });

  it("returns null when division is unknown", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 50 }),
    ];
    const s = computeMatchStats(1, null, cards);
    expect(s.matchPct).toBeNull();
  });

  it("returns null when no valid scorecards exist for the shooter", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 0, max_points: 50, dq: true }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.matchPct).toBeNull();
    expect(s.dq).toBe(true);
  });

  it("falls back to averaged-percentage formula when max_points is missing", () => {
    // Mirrors older cache entries where stage.max_points wasn't captured.
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5, max_points: 0 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 3, max_points: 0 }),
      // Division leader on each stage
      card({ competitor_id: 2, stage_id: 1, hit_factor: 5, max_points: 0 }),
      card({ competitor_id: 2, stage_id: 2, hit_factor: 6, max_points: 0 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    // Stage 1: 5/5 = 100%; Stage 2: 3/6 = 50%; avg = 75%
    expect(s.matchPct).toBeCloseTo(75, 4);
  });
});

describe("computeMatchStats — other fields preserved", () => {
  it("computes avgHF as the arithmetic mean of valid stage hit factors", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 4 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 6 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.avgHF).toBeCloseTo(5, 4);
    expect(s.stageCount).toBe(2);
  });

  it("counts perfect stages and aggregates hit-zone totals", () => {
    const cards: RawScorecard[] = [
      card({
        competitor_id: 1,
        stage_id: 1,
        a_hits: 10,
        c_hits: 0,
        d_hits: 0,
        miss_count: 0,
        no_shoots: 0,
        procedurals: 0,
      }),
      card({
        competitor_id: 1,
        stage_id: 2,
        a_hits: 8,
        c_hits: 1,
        d_hits: 1,
        miss_count: 0,
        no_shoots: 0,
        procedurals: 0,
      }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.perfectStages).toBe(1);
    expect(s.totalA).toBe(18);
    expect(s.totalC).toBe(1);
    expect(s.totalD).toBe(1);
  });

  it("computes a consistency index in (−∞, 100]; 100 = identical HF on every stage", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 5 }),
      card({ competitor_id: 1, stage_id: 3, hit_factor: 5 }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.consistencyIndex).toBeCloseTo(100, 4);
  });

  it("flags match-level DQ when any stage has dq=true", () => {
    const cards: RawScorecard[] = [
      card({ competitor_id: 1, stage_id: 1, hit_factor: 5 }),
      card({ competitor_id: 1, stage_id: 2, hit_factor: 0, dq: true }),
    ];
    const s = computeMatchStats(1, "Production Optics", cards);
    expect(s.dq).toBe(true);
  });
});
