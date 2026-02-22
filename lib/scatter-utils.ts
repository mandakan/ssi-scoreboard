// Pure utilities for the speed-vs-accuracy scatter chart (issue #10).

import type { StageComparison, CompetitorInfo } from "@/lib/types";

export interface ScatterPoint {
  time: number;
  points: number;
  hitFactor: number;
  competitorId: number;
  competitorName: string;
  stageName: string;
  stageNum: number;
}

export interface IsoHfLine {
  hf: number;
  x1: number; // time start (always 0)
  y1: number; // points start (always 0)
  x2: number; // time end (clipped to chart bounds)
  y2: number; // points end (clipped to chart bounds)
}

/**
 * Computes endpoints (in data coordinates) for iso-HF reference lines.
 * Each line runs from the origin (0, 0) with slope = HF (points per second),
 * clipped to the visible chart area defined by maxTime × maxPoints.
 */
export function computeIsoHfLines(
  maxTime: number,
  maxPoints: number,
  hfValues: number[] = [2, 4, 6, 8],
): IsoHfLine[] {
  if (maxTime <= 0 || maxPoints <= 0) return [];

  return hfValues.map((hf) => {
    // Line equation: points = hf * time
    // Find where it exits the chart bounds:
    //   - Top edge (points = maxPoints): time = maxPoints / hf
    //   - Right edge (time = maxTime):   points = hf * maxTime
    const xAtMaxPoints = maxPoints / hf;
    const yAtMaxTime = hf * maxTime;

    const x2 = xAtMaxPoints <= maxTime ? xAtMaxPoints : maxTime;
    const y2 = xAtMaxPoints <= maxTime ? maxPoints : yAtMaxTime;

    return { hf, x1: 0, y1: 0, x2, y2 };
  });
}

/**
 * Builds scatter data points grouped by competitor.
 * Excludes DNF, zeroed, DQ, and null time/points/hit_factor entries.
 */
export function buildScatterData(
  stages: StageComparison[],
  competitors: CompetitorInfo[],
): Record<number, ScatterPoint[]> {
  const result: Record<number, ScatterPoint[]> = {};
  for (const comp of competitors) {
    result[comp.id] = [];
  }

  for (const stage of stages) {
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      if (!sc) continue;
      if (sc.dnf || sc.zeroed || sc.dq) continue;
      if (sc.time === null || sc.time <= 0) continue;
      if (sc.points === null) continue;
      if (sc.hit_factor === null) continue;

      result[comp.id].push({
        time: sc.time,
        points: sc.points,
        hitFactor: sc.hit_factor,
        competitorId: comp.id,
        competitorName: comp.name,
        stageName: stage.stage_name,
        stageNum: stage.stage_num,
      });
    }
  }
  return result;
}
