import { detectMatchView } from "@/lib/mode";
import type { MatchResponse } from "@/lib/types";

/**
 * Coarse scoring phase of a match, from match-level data only (no scorecards).
 * "prematch" covers 0% scored and the early-window case (<25% while the match
 * is still inside its dates); "complete" is detectMatchView's coaching tier.
 */
export function matchScoresPhase(
  match: MatchResponse,
  nowMs: number,
): "prematch" | "live" | "complete" {
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
  if (view === "coaching") return "complete";
  return view === "prematch" ? "prematch" : "live";
}
