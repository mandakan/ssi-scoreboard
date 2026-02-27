// Pure functions for the what-if stage simulator. No I/O, fully unit-tested.
//
// Scoring rules (IPSC Comstock):
//   A = 5 pts (constant regardless of power factor)
//   C = 4 pts major / 3 pts minor
//   D = 2 pts major / 1 pt minor
//   Miss = 0 pts + 10 pt penalty
//
// Point deltas for swaps:
//   Miss → A: +15 pts (major and minor identical: +10 penalty removed + 5 hit)
//   A → C: −1 pt major / −2 pts minor

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
  const cDelta = isMajor ? -1 : -2;
  return adjustments.missToACount * 15 + adjustments.aToCCount * cDelta;
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
 * Computes the match-level impact of a simulated stage adjustment.
 *
 * For each selected competitor, recomputes their avg group % replacing the
 * simulated stage's value. When the simulated competitor becomes the group
 * leader for that stage, other competitors' stage % is scaled down accordingly.
 *
 * @param stages         All stages from CompareResponse
 * @param competitorId   The competitor whose stage was adjusted
 * @param allCompetitorIds All selected competitor IDs (used for group rank)
 * @param simResult      Result from simulateStageAdjustment
 */
export function simulateMatchImpact(
  stages: StageComparison[],
  competitorId: number,
  allCompetitorIds: number[],
  simResult: SimulatedStageResult
): SimulatedMatchResult {
  const leaderChanged =
    simResult.newGroupLeaderHF > (stages.find((s) => s.stage_id === simResult.stageId)?.group_leader_hf ?? 0);

  /**
   * Computes the avg group % for a competitor, optionally overriding the
   * simulated stage. When the leader changed, other competitors' stage %
   * on the simulated stage is scaled to the new leader HF.
   */
  function avgPct(compId: number, applySimulation: boolean): number | null {
    let sum = 0;
    let count = 0;

    for (const stage of stages) {
      const sc: CompetitorSummary | undefined = stage.competitors[compId];
      if (!sc || sc.dnf || sc.dq || sc.zeroed) continue;

      let groupPct: number | null;

      if (applySimulation && stage.stage_id === simResult.stageId) {
        if (compId === competitorId) {
          groupPct = simResult.newGroupPct;
        } else if (leaderChanged) {
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
