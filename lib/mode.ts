import type { MatchView } from "./types";

export interface DetectMatchViewArgs {
  /** Percentage of the match scored, 0-100. */
  scoringPct: number;
  /** Days since match.date — 0 = today, positive = past, negative = future. */
  daysSinceMatchStart: number;
  /** Days since match.ends — null if no end date set (caller should fall back to start). */
  daysSinceMatchEnd: number | null;
  /** SSI results visibility: "org" | "stg" | "cmp" | "all". */
  resultsStatus: string;
  /** SSI match lifecycle: "dr" | "on" | "ol" | "pr" | "cp" | "cs". */
  matchStatus: string;
  /** Whether any stage already has competitor scores in the compare response. */
  hasActualScores: boolean;
}

/**
 * Determine the default match view based on match state.
 *
 * Tiers (first match wins):
 *   - "coaching" — match is definitively done: results published, completed,
 *     ≥ 95% scored, or > 3 days since end.
 *   - "prematch" — no scoring yet, OR very early in the match (< 25% with the
 *     end date still ahead). Captures the day-before RO-squad case and the
 *     "early squads finished but my squad hasn't shot yet" case.
 *   - "live"     — active match with meaningful scoring progress.
 */
export function detectMatchView(args: DetectMatchViewArgs): MatchView {
  // When `match.ends` is missing, give a 3-day grace window past the start
  // date before treating the match as "old". SSI sets `ends=null` for many
  // matches even when they actually run multiple days, so naively falling
  // back to `daysSinceMatchStart` would auto-flip Level 3+ matches into
  // coaching mode while their late squads still haven't shot.
  const daysSinceEnd = args.daysSinceMatchEnd ?? (args.daysSinceMatchStart - 3);

  // Definitively done — always coaching.
  if (args.resultsStatus === "all") return "coaching";
  if (args.matchStatus === "cp") return "coaching";
  if (args.scoringPct >= 95) return "coaching";
  if (daysSinceEnd > 3) return "coaching";

  // Cancelled but not closed — show whatever partial scores there are.
  if (args.matchStatus === "cs") return "live";

  // No scoring at all — pre-match.
  if (args.scoringPct === 0 && !args.hasActualScores) return "prematch";

  // Early-stage match: < 25% scoring AND we're still inside the match window
  // (today is on/before the end date, with a small grace period). Covers
  // RO squads shooting the day before the main field, as well as morning
  // scoring on day 1 of a multi-day match. The end-date check is skipped
  // entirely when match.ends is null — single-day matches set ends=null and
  // we shouldn't punish that with a date-derived fallback.
  if (args.scoringPct < 25) {
    if (args.daysSinceMatchEnd == null) {
      // No end date: rely on start date — within 1 day of start counts as early.
      if (args.daysSinceMatchStart < 1) return "prematch";
    } else if (args.daysSinceMatchEnd < 1) {
      return "prematch";
    }
  }

  return "live";
}

/**
 * Whether the pre-match view is offered as a manual choice in the toggle.
 *
 * Rule: pre-match stays available as long as the match isn't done.
 * "Done" means results are officially published, the match is marked completed,
 * or scoring has reached 95 % — at that point every squad has shot, so the
 * "I haven't shot yet" use case no longer applies.
 *
 * We deliberately don't gate on dates here: SSI's `match.ends` is often null
 * (single-day matches) or set to the start date, so a date-based cutoff
 * misfires for multi-day Level 3+ matches whose `match.date` is several days
 * in the past while the user's squad still hasn't shot.
 */
export function isPreMatchEligible(args: {
  scoringPct: number;
  resultsStatus: string;
  matchStatus: string;
}): boolean {
  if (args.resultsStatus === "all") return false;
  if (args.matchStatus === "cp") return false;
  if (args.scoringPct >= 95) return false;
  return true;
}
