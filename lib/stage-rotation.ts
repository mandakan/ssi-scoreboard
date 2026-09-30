import type { MatchResponse, SquadInfo } from "@/lib/types";

/**
 * IPSC standard round-robin rotation (used by most matches).
 * Some matches use a different order -- this is a prediction, not a guarantee.
 * For squad number `squadNumber` (1-indexed) and round `round` (1-indexed),
 * returns the 0-based index into a stages array sorted by stage_number.
 */
export function stageIndexForRound(
  squadNumber: number,
  round: number,
  totalStages: number,
): number {
  return ((squadNumber - 1) + (round - 1)) % totalStages;
}

/**
 * Computes the round-robin rotation for a squad, ordered by stage_number.
 * Returns an array of {round (1-indexed), stage} pairs showing which stage
 * the squad shoots in each round.
 */
export function squadRotation<T extends { stage_number: number }>(
  squadNumber: number,
  stages: T[],
): { round: number; stage: T }[] {
  if (stages.length === 0) return [];

  // Sort stages by stage_number to get canonical order
  const sortedStages = [...stages].sort((a, b) => a.stage_number - b.stage_number);
  const N = sortedStages.length;

  // Map each round (1..N) to its stage in canonical order
  return Array.from({ length: N }, (_, roundIdx) => ({
    round: roundIdx + 1,
    stage: sortedStages[stageIndexForRound(squadNumber, roundIdx + 1, N)],
  }));
}

/**
 * Finds the squad containing the competitor whose shooterId matches.
 * Returns the SquadInfo object, or null if not found or shooterId is null.
 */
export function squadForShooter(
  match: Pick<MatchResponse, "squads" | "competitors">,
  shooterId: number | null,
): SquadInfo | null {
  if (shooterId === null) return null;

  // Find the competitor with this shooterId
  const competitor = match.competitors.find((c) => c.shooterId === shooterId);
  if (!competitor) return null;

  // Find the squad containing this competitor
  const squad = match.squads.find((s) => s.competitorIds.includes(competitor.id));
  return squad ?? null;
}
