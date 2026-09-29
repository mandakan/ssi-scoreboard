import { Skeleton } from "@/components/ui/skeleton";

/**
 * Neutral stand-in for a match tab until the client has hydrated. The tabs
 * depend on browser-only state (identity, tracked shooters, saved selection),
 * so the server cannot know which view to show; rendering this instead of a
 * guessed empty state avoids a visible (and announced) flip on hydration.
 */
export function MatchTabPlaceholder() {
  return (
    <div
      data-testid="match-tab-placeholder"
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="p-4 sm:p-6 max-w-6xl mx-auto space-y-3"
    >
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}
