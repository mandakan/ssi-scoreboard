import type { CompetitorInfo, FieldFingerprintPoint } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

export type SmartPresetKind =
  | "one-above"
  | "one-below"
  | "podium"
  | "percentile"
  | "same-club";

export interface SmartPreset {
  kind: SmartPresetKind;
  label: string;
  description: string;
  /** Competitor IDs to apply, capped to MAX_COMPETITORS, "me" first when included. */
  ids: number[];
}

/** Pick the rank closest to a given percentile (0-100) of N total. */
export function rankAtPercentile(percentile: number, n: number): number {
  if (n <= 0) return 1;
  // Higher percentile = better = lower rank number.
  const rank = Math.round(((100 - percentile) / 100) * (n - 1)) + 1;
  return Math.max(1, Math.min(n, rank));
}

/** Compute the smart-preset rows for a given identity context. Pure. */
export function computeSmartPresets(args: {
  myCompetitor: CompetitorInfo;
  myPoint: FieldFingerprintPoint;
  competitors: CompetitorInfo[];
  fieldFingerprintPoints: FieldFingerprintPoint[];
}): SmartPreset[] {
  const { myCompetitor, myPoint, competitors, fieldFingerprintPoints } = args;
  const myDivision = myPoint.division;
  if (!myDivision) return [];

  const competitorMap = new Map(competitors.map((c) => [c.id, c]));

  const divPoints = fieldFingerprintPoints
    .filter((p) => p.division === myDivision && p.actualDivRank !== null)
    .sort((a, b) => (a.actualDivRank ?? Infinity) - (b.actualDivRank ?? Infinity));

  const myRank = myPoint.actualDivRank;
  const divSize = divPoints.length;
  const presets: SmartPreset[] = [];

  if (myRank !== null && myRank > 1) {
    const aboveId = divPoints[myRank - 2]?.competitorId;
    if (aboveId != null) {
      const aboveComp = competitorMap.get(aboveId);
      presets.push({
        kind: "one-above",
        label: "One above me",
        description: aboveComp
          ? `Chasing target — ${aboveComp.name} (${myDivision} #${myRank - 1})`
          : "Chasing target",
        ids: [myCompetitor.id, aboveId],
      });
    }
  }

  if (myRank !== null && myRank < divSize) {
    const belowId = divPoints[myRank]?.competitorId;
    if (belowId != null) {
      const belowComp = competitorMap.get(belowId);
      presets.push({
        kind: "one-below",
        label: "One below me",
        description: belowComp
          ? `Defense gap — ${belowComp.name} (${myDivision} #${myRank + 1})`
          : "Defense gap",
        ids: [myCompetitor.id, belowId],
      });
    }
  }

  if (divSize >= 1) {
    const podiumIds = divPoints.slice(0, 3).map((p) => p.competitorId);
    const ids = Array.from(new Set([myCompetitor.id, ...podiumIds])).slice(
      0,
      MAX_COMPETITORS,
    );
    if (ids.length > 1) {
      presets.push({
        kind: "podium",
        label: "My division podium",
        description: `Aspirational ceiling — top ${Math.min(3, divSize)} in ${myDivision}`,
        ids,
      });
    }
  }

  if (divSize >= 4) {
    const cohortIds: number[] = [myCompetitor.id];
    for (const pct of [95, 75, 50, 25]) {
      const rank = rankAtPercentile(pct, divSize);
      const id = divPoints[rank - 1]?.competitorId;
      if (id != null && !cohortIds.includes(id)) cohortIds.push(id);
    }
    if (cohortIds.length > 2) {
      presets.push({
        kind: "percentile",
        label: "My percentile cohort",
        description: `Where do I sit? p25 · p50 · p75 · p95 of ${myDivision}`,
        ids: cohortIds.slice(0, MAX_COMPETITORS),
      });
    }
  }

  if (myCompetitor.club) {
    const clubIds = competitors
      .filter((c) => c.club === myCompetitor.club && c.id !== myCompetitor.id)
      .map((c) => c.id);
    if (clubIds.length > 0) {
      const ids = [myCompetitor.id, ...clubIds].slice(0, MAX_COMPETITORS);
      presets.push({
        kind: "same-club",
        label: "Same club",
        description: `Peers from ${myCompetitor.club} (${ids.length})`,
        ids,
      });
    }
  }

  return presets;
}
