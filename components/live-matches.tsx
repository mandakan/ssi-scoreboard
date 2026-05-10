"use client";

import { useRouter } from "next/navigation";
import { useLiveMatchesQuery } from "@/lib/queries";
import type { EventSummary } from "@/lib/types";

/**
 * Homepage "Live now" section. Surfaces matches whose scoring is in progress
 * right now — built primarily for users at the range looking for the match
 * they are attending or following. Self-hides when nothing is live so the
 * homepage stays uncluttered outside match days.
 *
 * Auto-refreshes every 60s; disabled when the tab is in the background.
 */
export function LiveMatches() {
  const { data, isLoading } = useLiveMatchesQuery();

  // Loading state intentionally renders nothing — flashing a skeleton above
  // the fold for a section that often has zero results would feel noisy.
  // The 30s staleTime + refetchInterval means a short blank during cold load
  // is preferable to layout thrash.
  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <section
      aria-labelledby="live-matches-heading"
      className="w-full max-w-2xl"
    >
      <h2
        id="live-matches-heading"
        className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2"
      >
        <LiveDot />
        Live now
        <span className="text-xs font-normal">({data.length})</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.map((match) => (
          <LiveMatchCard key={`${match.content_type}-${match.id}`} match={match} />
        ))}
      </div>
    </section>
  );
}

/** Pulsing green dot indicating active scoring. Decorative — the surrounding
 *  heading already says "Live now". */
function LiveDot() {
  return (
    <span
      className="relative inline-flex h-2 w-2 shrink-0"
      aria-hidden="true"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
    </span>
  );
}

export function LiveMatchCard({ match }: { match: EventSummary }) {
  const router = useRouter();
  const startedAgo = formatStartedAgo(match.date);

  // SSI's events list does not expose per-match scoring progress (the
  // `scoring_completed` aggregate they once exposed always returns 0 and is
  // deprecated; per-stage `scoring_progress` would multiply this query by
  // stage count for the entire result set, which we measured at 10+ seconds
  // worldwide). The card surfaces a "live" indicator only — the per-match
  // progress is shown on the match page itself, where stages are loaded.
  return (
    <button
      type="button"
      className="text-left rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={() => router.push(`/match/${match.content_type}/${match.id}`)}
      aria-label={`Open ${match.name}, live, started ${startedAgo}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-snug">{match.name}</span>
        <span
          className="text-sm font-medium text-muted-foreground shrink-0 tabular-nums"
          aria-hidden="true"
        >
          live
        </span>
      </div>

      <p className="text-xs text-muted-foreground mt-1 truncate">
        {[match.venue, startedAgo].filter(Boolean).join(" · ")}
      </p>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div className="h-full w-1/3 animate-pulse rounded-full bg-green-500/50" />
      </div>
    </button>
  );
}

/**
 * Render a compact "started Xm ago" / "started Xh ago" / "started yesterday"
 * label for a match's start timestamp. Falls back to null on missing input.
 */
function formatStartedAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const startMs = new Date(iso).getTime();
  if (!Number.isFinite(startMs)) return null;
  const ageMs = Date.now() - startMs;
  if (ageMs < 0) return "starting soon";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `started ${Math.max(1, minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `started ${hours}h ago`;
  return "started yesterday";
}
