// Pure functions for shooter dashboard statistics.
// Shared between the API route (server) and client components.

import type { ShooterMatchSummary, ShooterAggregateStats } from "@/lib/types";

/**
 * Compute linear regression slope (y over x).
 * Returns null when fewer than 3 points or denominator is zero.
 */
export function linearRegressionSlope(
  points: Array<[number, number]>,
): number | null {
  const n = points.length;
  if (n < 3) return null;
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  const sumXY = points.reduce((s, [x, y]) => s + x * y, 0);
  const sumXX = points.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute cross-match aggregate statistics from an array of match summaries.
 */
export function computeAggregateStats(
  matches: ShooterMatchSummary[],
): ShooterAggregateStats {
  const withHF = matches.filter((m) => m.avgHF != null);
  const withPct = matches.filter((m) => m.matchPct != null);

  const totalStages = matches.reduce((s, m) => s + m.stageCount, 0);

  // Date range from matches (already sorted newest first)
  const datesWithValues = matches
    .map((m) => m.date)
    .filter((d): d is string => d != null);
  const dateRange = {
    from: datesWithValues[datesWithValues.length - 1] ?? null,
    to: datesWithValues[0] ?? null,
  };

  // Weighted mean HF (weight = stage count per match)
  let overallAvgHF: number | null = null;
  if (withHF.length > 0) {
    const totalWeightedHF = withHF.reduce(
      (s, m) => s + (m.avgHF ?? 0) * m.stageCount,
      0,
    );
    const totalWeightStages = withHF.reduce((s, m) => s + m.stageCount, 0);
    overallAvgHF =
      totalWeightStages > 0 ? totalWeightedHF / totalWeightStages : null;
  }

  // Mean of per-match pct values
  const overallMatchPct =
    withPct.length > 0
      ? withPct.reduce((s, m) => s + (m.matchPct ?? 0), 0) / withPct.length
      : null;

  // Accuracy breakdown
  const totalA = matches.reduce((s, m) => s + m.totalA, 0);
  const totalC = matches.reduce((s, m) => s + m.totalC, 0);
  const totalD = matches.reduce((s, m) => s + m.totalD, 0);
  const totalMiss = matches.reduce((s, m) => s + m.totalMiss, 0);
  const totalHits = totalA + totalC + totalD + totalMiss;
  const aPercent = totalHits > 0 ? (totalA / totalHits) * 100 : null;
  const cPercent = totalHits > 0 ? (totalC / totalHits) * 100 : null;
  const dPercent = totalHits > 0 ? (totalD / totalHits) * 100 : null;
  const missPercent = totalHits > 0 ? (totalMiss / totalHits) * 100 : null;

  // Consistency CV = stddev(per-match avgHF) / mean(per-match avgHF)
  let consistencyCV: number | null = null;
  if (withHF.length >= 2) {
    const hfValues = withHF.map((m) => m.avgHF as number);
    const mean = hfValues.reduce((a, b) => a + b, 0) / hfValues.length;
    if (mean > 0) {
      const variance =
        hfValues.reduce((s, v) => s + (v - mean) ** 2, 0) / hfValues.length;
      consistencyCV = Math.sqrt(variance) / mean;
    }
  }

  // HF trend slope: x = chronological index (0-based, oldest first), y = avgHF
  // matches are sorted newest first, so reverse for the trend
  const hfTrendPoints: Array<[number, number]> = withHF
    .slice()
    .reverse()
    .map((m, i) => [i, m.avgHF as number]);
  const hfTrendSlope = linearRegressionSlope(hfTrendPoints);

  // Average penalty rate across matches that have shot data
  const withPenaltyData = matches.filter(
    (m) => m.totalA + m.totalC + m.totalD + m.totalMiss > 0,
  );
  const avgPenaltyRate =
    withPenaltyData.length > 0
      ? withPenaltyData.reduce(
          (s, m) => s + (computePenaltyRate(m) ?? 0),
          0,
        ) / withPenaltyData.length
      : null;

  // Average consistency index across matches that have it
  const withCI = matches.filter((m) => m.consistencyIndex != null);
  const avgConsistencyIndex =
    withCI.length > 0
      ? withCI.reduce((s, m) => s + (m.consistencyIndex ?? 0), 0) /
        withCI.length
      : null;

  return {
    totalStages,
    dateRange,
    overallAvgHF,
    overallMatchPct,
    aPercent,
    cPercent,
    dPercent,
    missPercent,
    consistencyCV,
    hfTrendSlope,
    avgPenaltyRate,
    avgConsistencyIndex,
  };
}

/**
 * Compute penalty rate for a single match:
 * (totalMiss + totalNoShoots + totalProcedurals) / totalShots
 * where totalShots = totalA + totalC + totalD + totalMiss.
 * Returns null when there are no shots fired. Range: 0.0–1.0.
 */
export function computePenaltyRate(match: ShooterMatchSummary): number | null {
  const totalShots =
    match.totalA + match.totalC + match.totalD + match.totalMiss;
  if (totalShots === 0) return null;
  const penalties =
    match.totalMiss +
    (match.totalNoShoots ?? 0) +
    (match.totalProcedurals ?? 0);
  return penalties / totalShots;
}

/**
 * Compute A-zone % for a single match: A / (A + C + D + Miss) * 100.
 * Returns null when there are no hit-zone totals.
 */
export function computeAZonePct(match: ShooterMatchSummary): number | null {
  const total = match.totalA + match.totalC + match.totalD + match.totalMiss;
  if (total === 0) return null;
  return (match.totalA / total) * 100;
}

/**
 * Compute a rolling moving average over an array of values (which may contain nulls).
 * Nulls in the input produce nulls in the output.
 * When the window hasn't accumulated enough non-null values, returns null.
 */
export function computeMovingAverage(
  values: (number | null)[],
  window: number,
): (number | null)[] {
  const result: (number | null)[] = [];
  const buf: number[] = [];

  for (const v of values) {
    if (v != null) {
      buf.push(v);
      if (buf.length > window) buf.shift();
      result.push(
        buf.length >= window
          ? buf.reduce((a, b) => a + b, 0) / buf.length
          : null,
      );
    } else {
      result.push(null);
    }
  }

  return result;
}

/**
 * Returns the division with the most matches, or null if no divisions exist.
 */
export function getMostFrequentDivision(
  matches: ShooterMatchSummary[],
): string | null {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.division) {
      counts.set(m.division, (counts.get(m.division) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;

  let best: string | null = null;
  let bestCount = 0;
  for (const [div, count] of counts) {
    if (count > bestCount) {
      best = div;
      bestCount = count;
    }
  }
  return best;
}
