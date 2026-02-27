import { Skeleton } from "@/components/ui/skeleton";
import { LoadingBar } from "@/components/loading-bar";

// Shown by Next.js Suspense streaming while the async MatchPage server
// component executes (i.e. while fetchMatchData runs against the cache).
// Must match the matchQuery.isLoading skeleton in match-page-client.tsx so
// there is no layout shift when one transitions into the other.
export default function Loading() {
  return (
    <>
      <LoadingBar matchLoaded={false} compareLoaded={false} hasCompetitors={false} />
      <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        {/* nav row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>

        {/* match header */}
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <div className="flex gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* stage list */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
        </div>

        {/* competitor picker */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
    </>
  );
}
