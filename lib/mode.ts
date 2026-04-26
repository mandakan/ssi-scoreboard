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
  const daysSinceEnd = args.daysSinceMatchEnd ?? args.daysSinceMatchStart;

  // Definitively done — always coaching.
  if (args.resultsStatus === "all") return "coaching";
  if (args.matchStatus === "cp") return "coaching";
  if (args.scoringPct >= 95) return "coaching";
  if (daysSinceEnd > 3) return "coaching";

  // Cancelled but not closed — show whatever partial scores there are.
  if (args.matchStatus === "cs") return "live";

  // No scoring at all — pre-match.
  if (args.scoringPct === 0 && !args.hasActualScores) return "prematch";

  // Early-stage match: < 25% scoring AND match end date is still in the future
  // (or today). Covers RO squads shooting the day before the main field.
  if (args.scoringPct < 25 && daysSinceEnd < 1) return "prematch";

  return "live";
}

/**
 * Whether the pre-match view is offered as a manual choice in the toggle.
 * Hidden once the match is wrapped up, since pre-match info is no longer useful.
 */
export function isPreMatchEligible(args: {
  scoringPct: number;
  daysSinceMatchStart: number;
  daysSinceMatchEnd: number | null;
  resultsStatus: string;
}): boolean {
  if (args.resultsStatus === "all") return false;
  if (args.scoringPct >= 95) return false;
  const daysSinceEnd = args.daysSinceMatchEnd ?? args.daysSinceMatchStart;
  if (daysSinceEnd > 2) return false;
  return true;
}
