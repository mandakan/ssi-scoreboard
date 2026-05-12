// Pure function for computing a shooter's career performance baseline.
// No I/O, fully unit-tested.

import type { ShooterMatchSummary } from "@/lib/types";

export interface CareerBaseline {
  /** Median per-match average hit factor, or null when insufficient data. */
  medianHF: number | null;
  /** Median per-match division % (0–100), or null when insufficient data. */
  medianMatchPct: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute career performance medians from match history.
 *
 * Returns null for each metric when fewer than `minMatches` valid data
 * points exist — a sparse history makes the baseline too noisy to display.
 */
export function computeCareerBaseline(
  matches: ShooterMatchSummary[],
  minMatches = 5,
): CareerBaseline {
  const hfValues = matches
    .map((m) => m.avgHF)
    .filter((v): v is number => v != null && v > 0);

  const pctValues = matches
    .map((m) => m.matchPct)
    .filter((v): v is number => v != null && v > 0);

  return {
    medianHF: hfValues.length >= minMatches ? median(hfValues) : null,
    medianMatchPct: pctValues.length >= minMatches ? median(pctValues) : null,
  };
}
