// Pure function — no I/O, no side effects. Fully unit-tested.
// Extracted from compare/route.ts to keep it separately testable.

import type {
  StageComparison,
  CompetitorSummary,
  CompetitorInfo,
} from "@/lib/types";

export interface RawScorecard {
  competitor_id: number;
  stage_id: number;
  stage_number: number;
  stage_name: string;
  max_points: number;
  points: number | null;
  hit_factor: number | null;
  time: number | null;
  dq: boolean;
  zeroed: boolean;
  dnf: boolean;
}

/**
 * Given raw scorecards for the selected competitors, compute group rankings
 * (rank within the group and percent of the group leader's points) per stage.
 *
 * - Competitors with DQ or zeroed are ranked last (points treated as 0 for % calc).
 * - Competitors with no scorecard yet (stage not fired) have null rank/percent.
 * - Tie-breaking: higher points = better rank; ties share the same rank.
 */
export function computeGroupRankings(
  scorecards: RawScorecard[],
  competitors: CompetitorInfo[]
): StageComparison[] {
  // Group scorecards by stage
  const byStage = new Map<number, RawScorecard[]>();
  for (const sc of scorecards) {
    const existing = byStage.get(sc.stage_id) ?? [];
    existing.push(sc);
    byStage.set(sc.stage_id, existing);
  }

  // Produce one StageComparison per stage, sorted by stage number
  const stageIds = [...byStage.keys()].sort((a, b) => {
    const aNum = byStage.get(a)![0].stage_number;
    const bNum = byStage.get(b)![0].stage_number;
    return aNum - bNum;
  });

  return stageIds.map((stageId) => {
    const stageScorecards = byStage.get(stageId)!;
    const first = stageScorecards[0];

    // Collect all competitors that have actually fired this stage
    const fired = stageScorecards.filter((sc) => !sc.dnf);

    // Compute group leader points (max valid points among fired competitors)
    const validPoints = fired
      .map((sc) => (sc.dq || sc.zeroed ? 0 : (sc.points ?? 0)))
      .filter((p) => p > 0);
    const groupLeaderPoints = validPoints.length > 0 ? Math.max(...validPoints) : null;

    // Rank fired competitors by points descending
    const sorted = [...fired].sort((a, b) => {
      const pa = a.dq || a.zeroed ? 0 : (a.points ?? 0);
      const pb = b.dq || b.zeroed ? 0 : (b.points ?? 0);
      return pb - pa;
    });

    // Assign ranks (ties share rank, next rank skips)
    const rankMap = new Map<number, number>();
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) {
        const prevPts = sorted[i - 1].dq || sorted[i - 1].zeroed ? 0 : (sorted[i - 1].points ?? 0);
        const currPts = sorted[i].dq || sorted[i].zeroed ? 0 : (sorted[i].points ?? 0);
        if (currPts < prevPts) currentRank = i + 1;
      }
      rankMap.set(sorted[i].competitor_id, currentRank);
    }

    // Build competitor summaries for ALL requested competitors
    const competitorMap: Record<number, CompetitorSummary> = {};
    for (const comp of competitors) {
      const sc = stageScorecards.find((s) => s.competitor_id === comp.id);

      if (!sc || sc.dnf) {
        // Not fired yet
        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: null,
          hit_factor: null,
          time: null,
          group_rank: null,
          group_percent: null,
          dq: sc?.dq ?? false,
          zeroed: sc?.zeroed ?? false,
          dnf: true,
        };
      } else {
        const pts = sc.dq || sc.zeroed ? 0 : (sc.points ?? null);
        const groupPct =
          pts != null && groupLeaderPoints != null && groupLeaderPoints > 0
            ? (pts / groupLeaderPoints) * 100
            : null;

        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: pts,
          hit_factor: sc.hit_factor,
          time: sc.time,
          group_rank: rankMap.get(comp.id) ?? null,
          group_percent: groupPct,
          dq: sc.dq,
          zeroed: sc.zeroed,
          dnf: false,
        };
      }
    }

    const comparison: StageComparison = {
      stage_id: stageId,
      stage_name: first.stage_name,
      stage_num: first.stage_number,
      max_points: first.max_points,
      group_leader_points: groupLeaderPoints, // reserved for future benchmark overlay
      competitors: competitorMap,
    };

    return comparison;
  });
}
