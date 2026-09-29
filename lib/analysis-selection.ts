import { MAX_COMPETITORS } from "@/lib/constants";
import { detectMatchView } from "@/lib/mode";
import type { CompareMode, MatchResponse } from "@/lib/types";

/**
 * Who Analysis compares on arrival (spec Section 1): an explicit URL wins,
 * then the user's saved edit for this match, then the grid's rows. A seeded
 * selection is not the user's choice, so callers must not persist it.
 */
export function initialAnalysisSelection(a: {
  urlIds: number[];
  savedIds: number[];
  gridRows: number[];
}): { ids: number[]; seeded: boolean } {
  if (a.urlIds.length > 0) return { ids: a.urlIds, seeded: false };
  if (a.savedIds.length > 0) return { ids: a.savedIds, seeded: false };
  if (a.gridRows.length > 0) {
    return { ids: a.gridRows.slice(0, MAX_COMPETITORS), seeded: true };
  }
  return { ids: [], seeded: false };
}

/** Replaces the mode toggle: poll live until the match is done. */
export function analysisCompareMode(match: MatchResponse, nowMs: number): CompareMode {
  const startMs = match.date ? new Date(match.date).getTime() : null;
  const endMs = match.ends ? new Date(match.ends).getTime() : null;
  const view = detectMatchView({
    scoringPct: match.scoring_pct,
    daysSinceMatchStart: startMs != null ? (nowMs - startMs) / 86_400_000 : 0,
    daysSinceMatchEnd: endMs != null ? (nowMs - endMs) / 86_400_000 : null,
    resultsStatus: match.results_status,
    matchStatus: match.match_status,
    hasActualScores: false,
  });
  return view === "coaching" ? "coaching" : "live";
}
