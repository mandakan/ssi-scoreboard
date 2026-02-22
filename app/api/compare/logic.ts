// Pure function — no I/O, no side effects. Fully unit-tested.
// Extracted from compare/route.ts to keep it separately testable.

import type {
  StageComparison,
  CompetitorSummary,
  CompetitorInfo,
} from "@/lib/types";

export interface RawScorecard {
  competitor_id: number;
  competitor_division: string | null; // handgun_div from IpscCompetitorNode
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
 * Effective hit factor for ranking purposes:
 *   - DNF → null  (excluded from rankings)
 *   - DQ / zeroed → 0  (ranked last)
 *   - Valid → actual hit_factor (may itself be null if not yet computed by API)
 */
function effectiveHF(sc: RawScorecard): number | null {
  if (sc.dnf) return null;
  if (sc.dq || sc.zeroed) return 0;
  return sc.hit_factor ?? 0;
}

/**
 * Rank a set of scorecards by hit factor descending.
 * Returns a rank map (competitor_id → rank) and the leader's HF.
 * DNF competitors are excluded. DQ/zeroed are treated as HF=0.
 * Ties share the same rank; the next rank skips accordingly.
 */
function rankByHF(scorecards: RawScorecard[]): {
  rankMap: Map<number, number>;
  leaderHF: number | null;
} {
  const fired = scorecards.filter((sc) => !sc.dnf);

  const sorted = [...fired].sort((a, b) => {
    return (effectiveHF(b) ?? 0) - (effectiveHF(a) ?? 0);
  });

  const rankMap = new Map<number, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prevHF = effectiveHF(sorted[i - 1]) ?? 0;
      const currHF = effectiveHF(sorted[i]) ?? 0;
      if (currHF < prevHF) currentRank = i + 1;
    }
    rankMap.set(sorted[i].competitor_id, currentRank);
  }

  const validHFs = fired
    .map((sc) => effectiveHF(sc) ?? 0)
    .filter((hf) => hf > 0);
  const leaderHF = validHFs.length > 0 ? Math.max(...validHFs) : null;

  return { rankMap, leaderHF };
}

function pct(hf: number | null, leaderHF: number | null): number | null {
  if (hf == null || leaderHF == null || leaderHF === 0) return null;
  return (hf / leaderHF) * 100;
}

/**
 * Given ALL scorecards for a match and the selected competitors, compute:
 *   - Group rankings (rank/% within selected competitors)
 *   - Division rankings (rank/% within each competitor's own division, full field)
 *   - Overall rankings (rank/% across the entire field regardless of division)
 *
 * Ranking uses hit factor (HF = points / time), not raw points.
 *
 * Rules:
 *   - DQ / zeroed → HF treated as 0, ranked last
 *   - DNF (stage not fired) → null rank/percent
 *   - Ties share the same rank; next rank skips
 */
export function computeGroupRankings(
  allScorecards: RawScorecard[],
  selectedCompetitors: CompetitorInfo[]
): StageComparison[] {
  const selectedIds = new Set(selectedCompetitors.map((c) => c.id));

  // Group ALL scorecards by stage
  const byStage = new Map<number, RawScorecard[]>();
  for (const sc of allScorecards) {
    const existing = byStage.get(sc.stage_id) ?? [];
    existing.push(sc);
    byStage.set(sc.stage_id, existing);
  }

  // Sort stage IDs by stage number
  const stageIds = [...byStage.keys()].sort((a, b) => {
    return byStage.get(a)![0].stage_number - byStage.get(b)![0].stage_number;
  });

  return stageIds.map((stageId) => {
    const allStage = byStage.get(stageId)!;
    const first = allStage[0];

    // Group rankings — selected competitors only
    const groupScorecards = allStage.filter((sc) =>
      selectedIds.has(sc.competitor_id)
    );
    const { rankMap: groupRankMap, leaderHF: groupLeaderHF } =
      rankByHF(groupScorecards);

    // Overall rankings — all competitors across all divisions
    const { rankMap: overallRankMap, leaderHF: overallLeaderHF } =
      rankByHF(allStage);

    // Division rankings — group by division string, rank within each
    const byDivision = new Map<string, RawScorecard[]>();
    for (const sc of allStage) {
      const key = sc.competitor_division ?? "__none__";
      const existing = byDivision.get(key) ?? [];
      existing.push(sc);
      byDivision.set(key, existing);
    }
    const divResults = new Map<
      string,
      { rankMap: Map<number, number>; leaderHF: number | null }
    >();
    for (const [div, divCards] of byDivision) {
      divResults.set(div, rankByHF(divCards));
    }

    // group_leader_points kept for the benchmark overlay hook (issue #1)
    const groupFired = groupScorecards.filter((sc) => !sc.dnf);
    const validPts = groupFired
      .map((sc) => (sc.dq || sc.zeroed ? 0 : (sc.points ?? 0)))
      .filter((p) => p > 0);
    const groupLeaderPoints = validPts.length > 0 ? Math.max(...validPts) : null;

    // Build competitor summaries for the selected competitors
    const competitorMap: Record<number, CompetitorSummary> = {};
    for (const comp of selectedCompetitors) {
      const sc = allStage.find((s) => s.competitor_id === comp.id);

      if (!sc || sc.dnf) {
        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: null,
          hit_factor: null,
          time: null,
          group_rank: null,
          group_percent: null,
          div_rank: null,
          div_percent: null,
          overall_rank: null,
          overall_percent: null,
          dq: sc?.dq ?? false,
          zeroed: sc?.zeroed ?? false,
          dnf: true,
        };
      } else {
        const hf = effectiveHF(sc);
        const pts = sc.dq || sc.zeroed ? 0 : (sc.points ?? null);
        const divKey = sc.competitor_division ?? "__none__";
        const divInfo = divResults.get(divKey);

        competitorMap[comp.id] = {
          competitor_id: comp.id,
          points: pts,
          hit_factor: hf,
          time: sc.time,
          group_rank: groupRankMap.get(comp.id) ?? null,
          group_percent: pct(hf, groupLeaderHF),
          div_rank: divInfo ? (divInfo.rankMap.get(comp.id) ?? null) : null,
          div_percent: divInfo ? pct(hf, divInfo.leaderHF) : null,
          overall_rank: overallRankMap.get(comp.id) ?? null,
          overall_percent: pct(hf, overallLeaderHF),
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
      group_leader_hf: groupLeaderHF,
      group_leader_points: groupLeaderPoints,
      overall_leader_hf: overallLeaderHF,
      competitors: competitorMap,
    };

    return comparison;
  });
}
