// Pure functions for the what-if stage simulator. No I/O, fully unit-tested.
//
// Scoring rules (IPSC Comstock):
//   A = 5 pts (constant regardless of power factor)
//   C = 4 pts major / 3 pts minor
//   D = 2 pts major / 1 pt minor
//   Miss = 0 pts + 10 pt penalty
//   No-shoot = 0 pts + 10 pt penalty
//   Procedural = 10 pt penalty (power factor irrelevant)
//
// Point deltas for swaps:
//   Miss → A:        +15 pts (major and minor identical: +10 penalty removed + 5 hit)
//   Miss → C:        +14 pts major / +13 pts minor (+10 penalty removed + 4 or 3 hit)
//   NS → A:          +15 pts (identical to miss → A)
//   NS → C:          +14 pts major / +13 pts minor (identical to miss → C)
//   C → A:           +1 pt major / +2 pts minor (inverse of old A → C)
//   D → A:           +3 pts major / +4 pts minor
//   D → C:           +2 pts major / +2 pts minor
//   Procedural removed: +10 pts (power factor irrelevant)
//   A → C:           −1 pt major / −2 pts minor (trade mode: accuracy for speed)
//   A → Miss:        −15 pts (both: inverse of miss → A)
//   A → NS:          −15 pts (both: inverse of NS → A)

import type {
  StageComparison,
  CompetitorSummary,
  StageSimulatorAdjustments,
  SimulatedStageResult,
  SimulatedMatchResult,
} from "@/lib/types";

/**
 * Returns true when the competitor shoots major power factor.
 * Detection is based on the formatted division string produced by
 * `formatDivisionDisplay()` — divisions that compete at both power factors
 * carry a " Major" or " Minor" suffix (e.g. "Open Major").
 * Production and Production Optics have no suffix and are always minor.
 */
export function isMajorPowerFactor(division: string | null): boolean {
  if (!division) return false;
  return division.endsWith(" Major");
}

/**
 * Computes the total point delta for a set of simulator adjustments.
 * Does NOT account for time — time affects HF but not raw points.
 */
export function computePointDelta(
  adjustments: StageSimulatorAdjustments,
  isMajor: boolean
): number {
  const missToCDelta = isMajor ? 14 : 13; // +10 penalty removed + 4 or 3 hit
  const cToADelta = isMajor ? 1 : 2;       // inverse of A→C
  const dToADelta = isMajor ? 3 : 4;       // D→A: major 2→5 = +3; minor 1→5 = +4
  const dToCDelta = 2;                      // D→C: major 2→4 = +2; minor 1→3 = +2
  const aToCDelta = isMajor ? -1 : -2;     // A→C: major 5→4 = -1; minor 5→3 = -2
  return (
    adjustments.missToACount * 15 +
    adjustments.missToCCount * missToCDelta +
    adjustments.nsToACount * 15 +
    adjustments.nsToCCount * missToCDelta +
    adjustments.cToACount * cToADelta +
    adjustments.dToACount * dToADelta +
    adjustments.dToCCount * dToCDelta +
    adjustments.removedProcedurals * 10 +
    adjustments.aToCCount * aToCDelta +
    adjustments.aToMissCount * -15 +
    adjustments.aToNSCount * -15
  );
}

/**
 * Simulates a single stage result after applying the given adjustments.
 *
 * Handles group leader change: if the simulated HF exceeds the current group
 * leader's HF, newGroupLeaderHF is updated to the simulated HF and
 * newGroupPct is capped at 100%.
 */
export function simulateStageAdjustment(
  competitor: CompetitorSummary,
  stage: StageComparison,
  adjustments: StageSimulatorAdjustments,
  isMajor: boolean
): SimulatedStageResult {
  const currentPoints = competitor.points ?? 0;
  const currentTime = competitor.time ?? 0;
  const currentHF = competitor.hit_factor ?? 0;

  const pointDelta = computePointDelta(adjustments, isMajor);
  const newPoints = currentPoints + pointDelta;
  const newTime = Math.max(0.001, currentTime + adjustments.timeDelta);
  const newHF = newTime > 0 ? newPoints / newTime : 0;

  // If simulated HF beats current group leader, the new leader HF is ours.
  const currentLeaderHF = stage.group_leader_hf ?? 0;
  const newGroupLeaderHF = Math.max(currentLeaderHF, newHF);

  const newGroupPct =
    newGroupLeaderHF > 0 ? (newHF / newGroupLeaderHF) * 100 : null;

  const currentGroupPct = competitor.group_percent ?? null;
  const groupPctDelta =
    newGroupPct != null && currentGroupPct != null
      ? newGroupPct - currentGroupPct
      : null;

  return {
    stageId: stage.stage_id,
    newPoints,
    newTime,
    newHF,
    newGroupLeaderHF,
    newGroupPct,
    pointDelta,
    hfDelta: newHF - currentHF,
    groupPctDelta,
  };
}

/**
 * Computes the match-level impact of one or more simulated stage adjustments.
 *
 * For each selected competitor, recomputes their avg group % replacing the
 * simulated stages' values. When the simulated competitor becomes the group
 * leader for a stage, other competitors' stage % is scaled down accordingly.
 *
 * @param stages           All stages from CompareResponse
 * @param competitorId     The competitor whose stages were adjusted
 * @param allCompetitorIds All selected competitor IDs (used for group rank)
 * @param simResults       Map of stageId → SimulatedStageResult (one or more stages)
 */
export function simulateMatchImpact(
  stages: StageComparison[],
  competitorId: number,
  allCompetitorIds: number[],
  simResults: Record<number, SimulatedStageResult>
): SimulatedMatchResult {
  // Pre-compute whether the leader changed per adjusted stage.
  const leaderChangedMap = new Map<number, boolean>();
  for (const [stageIdStr, simResult] of Object.entries(simResults)) {
    const stageId = Number(stageIdStr);
    const originalLeaderHF = stages.find((s) => s.stage_id === stageId)?.group_leader_hf ?? 0;
    leaderChangedMap.set(stageId, simResult.newGroupLeaderHF > originalLeaderHF);
  }

  /**
   * Computes the avg group % for a competitor, optionally overriding the
   * simulated stages. When the leader changed for a stage, other competitors'
   * stage % is scaled to the new leader HF.
   */
  function avgPct(compId: number, applySimulation: boolean): number | null {
    let sum = 0;
    let count = 0;

    for (const stage of stages) {
      const sc: CompetitorSummary | undefined = stage.competitors[compId];
      if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;

      let groupPct: number | null;
      const simResult = applySimulation ? simResults[stage.stage_id] : undefined;

      if (simResult) {
        if (compId === competitorId) {
          groupPct = simResult.newGroupPct;
        } else if (leaderChangedMap.get(stage.stage_id)) {
          // Scale down: other competitor keeps their HF but compares to new leader
          const otherHF = sc.hit_factor ?? 0;
          groupPct =
            simResult.newGroupLeaderHF > 0
              ? (otherHF / simResult.newGroupLeaderHF) * 100
              : null;
        } else {
          groupPct = sc.group_percent ?? null;
        }
      } else {
        groupPct = sc.group_percent ?? null;
      }

      if (groupPct != null) {
        sum += groupPct;
        count++;
      }
    }

    return count > 0 ? sum / count : null;
  }

  const currentMatchPct = avgPct(competitorId, false);
  const newMatchPct = avgPct(competitorId, true);

  // Compute simulated averages for all selected competitors to determine group rank.
  const simAvgs: { id: number; avg: number }[] = [];
  const baseAvgs: { id: number; avg: number }[] = [];
  for (const compId of allCompetitorIds) {
    const simAvg = avgPct(compId, true);
    const baseAvg = avgPct(compId, false);
    if (simAvg != null) simAvgs.push({ id: compId, avg: simAvg });
    if (baseAvg != null) baseAvgs.push({ id: compId, avg: baseAvg });
  }

  simAvgs.sort((a, b) => b.avg - a.avg);
  baseAvgs.sort((a, b) => b.avg - a.avg);

  const newRankIdx = simAvgs.findIndex((c) => c.id === competitorId);
  const baseRankIdx = baseAvgs.findIndex((c) => c.id === competitorId);

  const newGroupRank = newRankIdx >= 0 ? newRankIdx + 1 : null;
  const baseGroupRank = baseRankIdx >= 0 ? baseRankIdx + 1 : null;

  return {
    newMatchPct,
    matchPctDelta:
      newMatchPct != null && currentMatchPct != null
        ? newMatchPct - currentMatchPct
        : null,
    newGroupRank,
    groupRankDelta:
      newGroupRank != null && baseGroupRank != null
        ? baseGroupRank - newGroupRank // positive = improved (lower rank number)
        : null,
  };
}
