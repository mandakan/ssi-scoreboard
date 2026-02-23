"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  subscribeRecent,
  getRecentCompetitionsSnapshot,
  removeRecentCompetition,
  type StoredCompetition,
} from "@/lib/competition-store";

function CompetitionCard({
  comp,
  onRemove,
}: {
  comp: StoredCompetition;
  onRemove: () => void;
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
      <button
        className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        aria-label={`Remove ${comp.name} from recent competitions`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <button
        className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring rounded"
        onClick={() => router.push(`/match/${comp.ct}/${comp.id}`)}
        aria-label={`Open ${comp.name}`}
      >
        <div className="flex items-start justify-between gap-2 pr-6">
          <span className="font-semibold leading-snug">{comp.name}</span>
          <span className="text-sm font-medium text-muted-foreground shrink-0">
            {comp.scoring_completed}%
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
          aria-label={`${comp.scoring_completed}% scored`}
        />
      </button>
    </div>
  );
}

const EMPTY_COMPETITIONS: StoredCompetition[] = [];

export function RecentCompetitions() {
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
        No recent competitions. Paste a match URL above to get started.
      </p>
    );
  }

  function handleRemove(ct: string, id: string) {
    removeRecentCompetition(ct, id);
    // The RECENTS_CHANGED event fired inside removeRecentCompetition
    // will cause useSyncExternalStore to re-render with updated data.
  }

  return (
    <section aria-labelledby="recent-heading" className="w-full max-w-2xl">
      <h2
        id="recent-heading"
        className="text-sm font-semibold text-muted-foreground mb-3"
      >
        Recent competitions
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {competitions.map((comp) => (
          <CompetitionCard
            key={`${comp.ct}-${comp.id}`}
            comp={comp}
            onRemove={() => handleRemove(comp.ct, comp.id)}
          />
        ))}
      </div>
    </section>
  );
}
