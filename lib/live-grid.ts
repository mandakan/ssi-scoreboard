import type { RawScorecard } from "@/app/api/compare/logic";
import type { LiveGridCell, LiveGridStage, LiveGridResponse, MatchResponse } from "@/lib/types";

/**
 * Project raw scorecards into the live grid's cell map.
 *
 * Deliberately field-blind: every value comes from the shooter's own card.
 * Nothing here may consult other competitors -- that invariant is what lets
 * the Phase 2 per-competitor fetch drop in without a client change. See
 * docs/superpowers/specs/2026-08-23-live-grid-design.md.
 */
export function buildLiveGridCells(
  scorecards: RawScorecard[],
  competitorIds: number[],
): Record<number, Record<number, LiveGridCell>> {
  const wanted = new Set(competitorIds);
  const out: Record<number, Record<number, LiveGridCell>> = {};
  for (const id of competitorIds) out[id] = {};

  for (const sc of scorecards) {
    if (!wanted.has(sc.competitor_id)) continue;
    out[sc.competitor_id][sc.stage_id] = {
      hf: sc.hit_factor,
      time: sc.time,
      points: sc.points,
      a: sc.a_hits,
      c: sc.c_hits,
      d: sc.d_hits,
      m: sc.miss_count,
      ns: sc.no_shoots,
      p: sc.procedurals,
      status: classify(sc),
      created: sc.scorecard_created ?? null,
    };
  }
  return out;
}

// Order matters: a DQ'd card can also carry zeroed/dnf flags, and DQ is the
// one the shooter needs to see.
function classify(sc: RawScorecard): LiveGridCell["status"] {
  if (sc.dq) return "dq";
  if (sc.zeroed) return "zeroed";
  if (sc.dnf) return "not_fired";
  if (sc.incomplete) return "incomplete";
  return "scored";
}

/**
 * The stage the visible shooters most recently produced a scorecard on.
 *
 * The grid opens scrolled here, because it is the stage they just shot.
 * Null when nothing has been scored yet: there is no live edge to show.
 */
export function computeLiveEdgeStageId(
  cells: Record<number, Record<number, LiveGridCell>>,
  stages: LiveGridStage[],
): number | null {
  if (stages.length === 0) return null;

  let bestStage: number | null = null;
  let bestAt = "";
  for (const byStage of Object.values(cells)) {
    for (const [stageId, cell] of Object.entries(byStage)) {
      if (!cell.created) continue;
      // ISO-8601 UTC strings compare correctly lexicographically.
      if (cell.created > bestAt) {
        bestAt = cell.created;
        bestStage = Number(stageId);
      }
    }
  }
  return bestStage;
}

/**
 * Builds a LiveGridResponse with empty cells from match metadata only.
 * Stages are taken from match.stages; shooters are resolved from rowIds
 * by looking up the corresponding competitors in match.competitors.
 * Squad names are resolved for each shooter based on SquadInfo.
 * Unknown row IDs are silently dropped.
 */
export function buildEmptyGrid(
  match: Pick<MatchResponse, "stages" | "competitors" | "squads">,
  rowIds: number[],
): LiveGridResponse {
  // Build a map of competitor ID -> squad name (or null)
  const competitorSquadMap = new Map<number, string | null>();
  for (const squad of match.squads) {
    for (const cId of squad.competitorIds) {
      competitorSquadMap.set(cId, squad.name);
    }
  }

  // Build stages array from match.stages
  const stages = match.stages.map((s) => ({
    stage_id: s.id,
    stage_num: s.stage_number,
    name: s.name,
    max_points: s.max_points,
  }));

  // Build shooters array by resolving rowIds to competitors
  const shooters = [];
  const cells: Record<number, Record<number, LiveGridCell>> = {};

  for (const rowId of rowIds) {
    const competitor = match.competitors.find((c) => c.id === rowId);
    if (!competitor) continue; // Unknown row ID, drop it

    shooters.push({
      id: competitor.id,
      shooterId: competitor.shooterId,
      name: competitor.name,
      competitor_number: competitor.competitor_number,
      division: competitor.division,
      squad: competitorSquadMap.get(competitor.id) ?? null,
    });

    cells[rowId] = {};
  }

  return {
    match_id: 0,
    stages,
    shooters,
    cells,
    cacheInfo: { cachedAt: null },
  };
}
