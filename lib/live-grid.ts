import type { RawScorecard } from "@/app/api/compare/logic";
import type { LiveGridCell, LiveGridStage } from "@/lib/types";

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
 * Falls back to the first stage so a pre-scoring match still lands somewhere.
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
  return bestStage ?? stages[0].stage_id;
}
