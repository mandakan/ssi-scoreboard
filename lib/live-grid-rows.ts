import { MAX_LIVE_GRID_ROWS } from "@/lib/constants";
import type { CompetitorInfo, SquadInfo } from "@/lib/types";

/** Where the live grid's rows come from. Both resolve entirely from the
 *  already-cached GetMatch response -- no extra upstream cost. */
export type GridRowSource = "squad" | "tracked";

export interface ResolveGridRowsArgs {
  source: GridRowSource;
  competitors: CompetitorInfo[];
  squads: SquadInfo[];
  myShooterId: number | null;
  trackedShooterIds: Set<number>;
  /** The user's existing competitor selection, used when the chosen source
   *  resolves to nothing (they're in no squad, or track nobody here). */
  fallback: number[];
}

/**
 * Resolve which competitor IDs fill the grid's rows.
 *
 * Pure, so the fiddly bits -- shooterId to competitorId mapping, the
 * fallback, the cap -- are testable without mounting the grid.
 */
export function resolveGridRows(args: ResolveGridRowsArgs): number[] {
  const {
    source,
    competitors,
    squads,
    myShooterId,
    trackedShooterIds,
    fallback,
  } = args;

  const myCompetitorId =
    myShooterId == null
      ? null
      : (competitors.find((c) => c.shooterId === myShooterId)?.id ?? null);

  let ids: number[];
  if (source === "squad") {
    const squad =
      myCompetitorId == null
        ? undefined
        : squads.find((s) => s.competitorIds.includes(myCompetitorId));
    ids = squad ? [...squad.competitorIds] : [];
  } else {
    const wanted = new Set(trackedShooterIds);
    if (myShooterId != null) wanted.add(myShooterId);
    // shooterId can be null for competitors SSI hasn't linked to a profile;
    // those can never match a tracked ID.
    ids = competitors
      .filter((c) => c.shooterId != null && wanted.has(c.shooterId))
      .map((c) => c.id);
  }

  if (ids.length === 0) ids = [...fallback];

  // My own row leads, so it's the one already on screen before any scrolling.
  if (myCompetitorId != null && ids.includes(myCompetitorId)) {
    ids = [myCompetitorId, ...ids.filter((id) => id !== myCompetitorId)];
  }

  return ids.slice(0, MAX_LIVE_GRID_ROWS);
}
