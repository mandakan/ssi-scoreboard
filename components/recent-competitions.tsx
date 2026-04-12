"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  subscribeRecent,
  getRecentCompetitionsSnapshot,
  removeRecentCompetition,
  type StoredCompetition,
} from "@/lib/competition-store";

/** Minimum data needed to render a CompetitionCard. */
export interface CompetitionCardData {
  ct: string;
  id: string;
  name: string;
  venue: string | null;
  date: string | null;
  scoring_completed: number;
}

export function CompetitionCard({
  comp,
  onRemove,
}: {
  comp: CompetitionCardData;
  onRemove?: () => void;
}) {
  const router = useRouter();

  const date = comp.date
    ? new Date(comp.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="relative rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors group">
      {onRemove && (
        <button
          className="absolute top-2 right-2 p-1.5 rounded text-muted-foreground hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label={`Remove ${comp.name} from recent competitions`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}

      <button
        className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
        onClick={() => router.push(`/match/${comp.ct}/${comp.id}`)}
        aria-label={`Open ${comp.name}`}
      >
        <div className="flex items-start justify-between gap-2 pr-6">
          <span className="font-semibold leading-snug">{comp.name}</span>
          <span className="text-sm font-medium text-muted-foreground shrink-0">
            {Math.round(comp.scoring_completed)}%
          </span>
        </div>

        {(comp.venue || date) && (
          <p className="text-xs text-muted-foreground mt-1">
            {[comp.venue, date].filter(Boolean).join(" · ")}
          </p>
        )}

        <Progress
          value={comp.scoring_completed}
          className="mt-3 h-1.5"
          aria-label={`${Math.round(comp.scoring_completed)}% scored`}
        />
      </button>
    </div>
  );
}

const EMPTY_COMPETITIONS: StoredCompetition[] = [];
const INITIAL_VISIBLE = 8;

export function RecentCompetitions() {
  const [showAll, setShowAll] = useState(false);
  // useSyncExternalStore handles SSR safety: getServerSnapshot returns []
  // and the client snapshot reads from localStorage after hydration.
  const competitions = useSyncExternalStore(
    subscribeRecent,
    getRecentCompetitionsSnapshot,
    () => EMPTY_COMPETITIONS
  );

  if (competitions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        Your recently viewed competitions will appear here.
      </p>
    );
  }

  function handleRemove(ct: string, id: string) {
    removeRecentCompetition(ct, id);
    // The RECENTS_CHANGED event fired inside removeRecentCompetition
    // will cause useSyncExternalStore to re-render with updated data.
  }

  const visible = showAll ? competitions : competitions.slice(0, INITIAL_VISIBLE);
  const hiddenCount = competitions.length - INITIAL_VISIBLE;

  return (
    <section aria-labelledby="recent-heading" className="w-full max-w-2xl">
      <h2
        id="recent-heading"
        className="text-sm font-semibold text-muted-foreground mb-3"
      >
        My recents
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((comp) => (
          <CompetitionCard
            key={`${comp.ct}-${comp.id}`}
            comp={comp}
            onRemove={() => handleRemove(comp.ct, comp.id)}
          />
        ))}
      </div>
      {competitions.length > INITIAL_VISIBLE && (
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
