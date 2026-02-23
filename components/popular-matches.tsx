"use client";

import { useSyncExternalStore } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CompetitionCard,
  type CompetitionCardData,
} from "@/components/recent-competitions";
import {
  subscribeRecent,
  getRecentCompetitionsSnapshot,
} from "@/lib/competition-store";
import { usePopularMatchesQuery } from "@/lib/queries";

const EMPTY_COMPETITIONS: CompetitionCardData[] = [];

/**
 * Displays matches recently accessed by any user (sourced from Redis cache).
 * Matches already present in "My Recents" are excluded to avoid duplication.
 */
export function PopularMatches() {
  const { data: popular, isLoading } = usePopularMatchesQuery();

  // Read user's own recents to deduplicate the Popular list.
  const myRecents = useSyncExternalStore(
    subscribeRecent,
    getRecentCompetitionsSnapshot,
    () => EMPTY_COMPETITIONS,
  );

  const myRecentKeys = new Set(
    myRecents.map((c) => `${c.ct}-${c.id}`),
  );

  const filtered = (popular ?? []).filter(
    (m) => !myRecentKeys.has(`${m.ct}-${m.id}`),
  );

  if (isLoading) {
    return (
      <section aria-labelledby="popular-heading" className="w-full max-w-2xl">
        <h2
          id="popular-heading"
          className="text-sm font-semibold text-muted-foreground mb-3"
        >
          Popular
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[88px] rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (filtered.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="popular-heading" className="w-full max-w-2xl">
      <h2
        id="popular-heading"
        className="text-sm font-semibold text-muted-foreground mb-3"
      >
        Popular
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((match) => (
          <CompetitionCard key={`${match.ct}-${match.id}`} comp={match} />
        ))}
      </div>
    </section>
  );
}
