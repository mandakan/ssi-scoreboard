"use client";

import { createContext, useContext, useMemo } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMatchQuery } from "@/lib/queries";
import type { EventSummary, MatchResponse, Visibility } from "@/lib/types";

interface MatchContextValue {
  ct: string;
  id: string;
  match: MatchResponse;
  isFetching: boolean;
}

const MatchContext = createContext<MatchContextValue | null>(null);

export function useMatch(): MatchContextValue {
  const v = useContext(MatchContext);
  if (!v) throw new Error("useMatch() must be used inside <MatchGate>");
  return v;
}

/**
 * Owns the match query's loading and error states for every match tab, and
 * hands the loaded match to the tabs through useMatch(). Tabs can assume the
 * match is present.
 */
export function MatchGate({
  ct,
  id,
  children,
}: {
  ct: string;
  id: string;
  children: React.ReactNode;
}) {
  const matchQuery = useMatchQuery(ct, id);
  const queryClient = useQueryClient();

  const knownVisibility: Visibility | null = useMemo(() => {
    if (!matchQuery.isError) return null;
    const ctNum = Number(ct);
    const idNum = Number(id);
    const matchEntry = (list: unknown): EventSummary | undefined => {
      if (!Array.isArray(list)) return undefined;
      return (list as EventSummary[]).find(
        (e) => e.id === idNum && e.content_type === ctNum,
      );
    };
    const candidates = [
      ...queryClient.getQueriesData<EventSummary[]>({ queryKey: ["live-matches"] }),
      ...queryClient.getQueriesData<EventSummary[]>({ queryKey: ["events"] }),
    ];
    for (const [, data] of candidates) {
      const hit = matchEntry(data);
      if (hit?.visibility) return hit.visibility;
    }
    return null;
  }, [matchQuery.isError, queryClient, ct, id]);

  const value = useMemo(
    () =>
      matchQuery.data
        ? { ct, id, match: matchQuery.data, isFetching: matchQuery.isFetching === true }
        : null,
    [ct, id, matchQuery.data, matchQuery.isFetching],
  );

  if (matchQuery.isLoading) {
    return (
      <div data-testid="match-gate-loading" className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
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
    );
  }

  if (matchQuery.isError || !value) {
    // SSI returns null for the match node when the requesting account isn't
    // allowed to read it — most often a non-public match where the bot hasn't
    // been invited as Staff. When the user reached this page from a list that
    // carries visibility info, we can say so explicitly (`knownVisibility`).
    // Otherwise we hedge between "private" and "removed" so the copy is
    // accurate either way.
    const errMsg = matchQuery.error?.message ?? "";
    // fetchMatch() throws `Match fetch failed (404): ...` when the API returns
    // 404. Any non-404 (e.g. 502 from a degraded upstream) renders the
    // generic failure copy instead of the "private" explainer.
    const isNotFound = !matchQuery.isError || /\(404\)/.test(errMsg);
    const confirmedPrivate =
      isNotFound && knownVisibility?.class === "organizer-published";
    return (
      <div className="min-h-[60dvh] flex flex-col items-center justify-center gap-4 p-8">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center space-y-4">
          <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" aria-hidden="true" />
          {isNotFound && confirmedPrivate ? (
            <>
              <h1 className="text-lg font-semibold">This match is private</h1>
              <div className="text-sm text-muted-foreground space-y-2 text-left" role="alert">
                <p>
                  The organizer marked this match as{" "}
                  <em>{knownVisibility?.displayName || "non-public"}</em> on
                  ShootNScoreIt and hasn{"’"}t published it to the scoreboard,
                  so we can{"’"}t show its details here.
                </p>
                <p>
                  If you organize this match and want to make it viewable, see{" "}
                  <Link
                    href="/about/organizer-published"
                    className="text-primary hover:underline underline-offset-2"
                  >
                    how to publish a private match
                  </Link>
                  .
                </p>
              </div>
            </>
          ) : isNotFound ? (
            <>
              <h1 className="text-lg font-semibold">Match not viewable</h1>
              <div className="text-sm text-muted-foreground space-y-2 text-left" role="alert">
                <p>
                  We couldn{"’"}t load this match. There are two common reasons:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    It{"’"}s a <strong>private match</strong> on ShootNScoreIt
                    and the organizer hasn{"’"}t published it to the scoreboard.
                  </li>
                  <li>The match has been removed or doesn{"’"}t exist.</li>
                </ul>
                <p>
                  If you organize a private match and want to make it viewable
                  here, see{" "}
                  <Link
                    href="/about/organizer-published"
                    className="text-primary hover:underline underline-offset-2"
                  >
                    how to publish a private match
                  </Link>
                  .
                </p>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold">Failed to load match</h1>
              <p className="text-sm text-muted-foreground" role="alert">
                {errMsg || "Something went wrong."}
              </p>
            </>
          )}
          <Button variant="outline" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return <MatchContext.Provider value={value}>{children}</MatchContext.Provider>;
}
