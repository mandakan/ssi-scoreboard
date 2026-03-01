import type { CompareMode } from "./types";

/**
 * Determine the default compare mode based on match state.
 * "coaching" for completed matches (≥ 95% scored or > 3 days old).
 * "live" for active matches where fast polling matters.
 */
export function detectMode(scoringPct: number, daysSinceMatch: number): CompareMode {
  if (scoringPct >= 95 || daysSinceMatch > 3) return "coaching";
  return "live";
}
