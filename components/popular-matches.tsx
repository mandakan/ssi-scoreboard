"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
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
const INITIAL_VISIBLE = 8;

/**
 * Displays matches recently accessed by any user (sourced from Redis cache).
 * Matches already present in "My Recents" are excluded to avoid duplication.
 */
export function PopularMatches() {
  const { data: popular, isLoading } = usePopularMatchesQuery();
  const [showAll, setShowAll] = useState(false);

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

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);
  const hiddenCount = filtered.length - INITIAL_VISIBLE;

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
        {visible.map((match) => (
          <CompetitionCard key={`${match.ct}-${match.id}`} comp={match} />
        ))}
      </div>
      {filtered.length > INITIAL_VISIBLE && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          aria-expanded={showAll}
          className="mt-3 w-full py-2 flex items-center justify-center gap-1 text-sm text-muted-foreground"
        >
          {showAll ? "Show less" : `Show more (${hiddenCount})`}
          <ChevronDown
            className={`w-4 h-4 transition-transform${showAll ? " rotate-180" : ""}`}
          />
        </button>
      )}
    </section>
  );
}
