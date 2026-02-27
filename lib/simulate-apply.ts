// Pure helper: apply what-if adjustments to a competitor's raw scorecards.
// No I/O, no side effects. Fully unit-tested.

import type { RawScorecard } from "@/app/api/compare/logic";
import type { StageSimulatorAdjustments } from "@/lib/types";
import { computePointDelta, isMajorPowerFactor } from "@/lib/what-if-calc";

/**
 * Apply a set of per-stage adjustments to a competitor's scorecards.
 *
 * Returns a new RawScorecard[] with the competitor's modified entries
 * replaced; all other competitors' entries are unchanged.
 * Does not mutate the input array.
 *
 * Zone counts are updated to reflect the swaps:
 *   - missToA: miss_count -= n, a_hits += n
 *   - missToC: miss_count -= n, c_hits += n
 *   - nsToA:   no_shoots -= n, a_hits += n
 *   - nsToC:   no_shoots -= n, c_hits += n
 *   - cToA:    c_hits -= n, a_hits += n
 *   - dToA:    d_hits -= n, a_hits += n
 *   - dToC:    d_hits -= n, c_hits += n
 *   - removedProcedurals: procedurals -= n
 */
export function applyAdjustmentsToScorecards(
  scorecards: RawScorecard[],
  competitorId: number,
  competitorDivision: string | null,
  adjustments: Record<number, StageSimulatorAdjustments>
): RawScorecard[] {
  const isMajor = isMajorPowerFactor(competitorDivision);

  return scorecards.map((sc) => {
    if (sc.competitor_id !== competitorId) return sc;

    const adj = adjustments[sc.stage_id];
    if (!adj) return sc;

    const pointDelta = computePointDelta(adj, isMajor);

    const newPoints = (sc.points ?? 0) + pointDelta;
    const newTime = Math.max(0.001, (sc.time ?? 0) + adj.timeDelta);
    const newHF = newTime > 0 ? newPoints / newTime : 0;

    return {
      ...sc,
      points: newPoints,
      time: newTime,
      hit_factor: newHF,
      a_hits:
        sc.a_hits != null
          ? sc.a_hits + adj.missToACount + adj.nsToACount + adj.cToACount + adj.dToACount
          : sc.a_hits,
      c_hits:
        sc.c_hits != null
          ? sc.c_hits + adj.missToCCount + adj.nsToCCount - adj.cToACount + adj.dToCCount
          : sc.c_hits,
      d_hits:
        sc.d_hits != null
          ? sc.d_hits - adj.dToACount - adj.dToCCount
          : sc.d_hits,
      miss_count:
        sc.miss_count != null
          ? sc.miss_count - adj.missToACount - adj.missToCCount
          : sc.miss_count,
      no_shoots:
        sc.no_shoots != null
          ? sc.no_shoots - adj.nsToACount - adj.nsToCCount
          : sc.no_shoots,
      procedurals:
        sc.procedurals != null
          ? sc.procedurals - adj.removedProcedurals
          : sc.procedurals,
    };
  });
}
