"use client";

import { useCallback, useSyncExternalStore, useEffect, useRef } from "react";

// Stable empty array for useSyncExternalStore server snapshot — must be a
// constant reference so React's referential equality check doesn't loop.
const EMPTY_IDS: number[] = [];
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MatchHeader } from "@/components/match-header";
import { StageList } from "@/components/stage-list";
import { ShareButton } from "@/components/share-button";
import { CompetitorPicker } from "@/components/competitor-picker";
import { ComparisonTable } from "@/components/comparison-table";
import { ComparisonChart } from "@/components/comparison-chart";
import { SpeedAccuracyChart } from "@/components/scatter-chart";
import { StageBalanceChart } from "@/components/radar-chart";
import { useMatchQuery, useCompareQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import {
  saveRecentCompetition,
  saveCompetitorSelection,
  getCompetitorSelectionSnapshot,
  SELECTION_CHANGED,
} from "@/lib/competition-store";

export default function MatchPage() {
  const params = useParams<{ ct: string; id: string }>();
  const { ct, id } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  // On mount: seed localStorage from ?competitors= URL param (shared links),
  // or reflect existing localStorage selection into the URL (backward compat).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const competitorsParam = searchParams.get("competitors");
    if (competitorsParam) {
      const ids = competitorsParam
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length > 0) {
        saveCompetitorSelection(ct, id, ids);
      }
    } else {
      const localIds = getCompetitorSelectionSnapshot(ct, id);
      if (localIds.length > 0) {
        router.replace(`?competitors=${localIds.join(",")}`, { scroll: false });
      }
    }
  }, [ct, id, searchParams, router]);

  // Use useSyncExternalStore to read competitor selection from localStorage.
  // This handles SSR (server snapshot = []) and client-side hydration correctly,
  // and avoids setState-in-effect for restoration.
  const selectedIds = useSyncExternalStore(
    useCallback(
      (onChange) => {
        const handler = (e: Event) => {
          const ev = e as CustomEvent<{ ct: string; id: string }>;
          if (ev.detail?.ct === ct && ev.detail?.id === id) onChange();
        };
        window.addEventListener(SELECTION_CHANGED, handler);
        return () => window.removeEventListener(SELECTION_CHANGED, handler);
      },
      [ct, id]
    ),
    useCallback(() => getCompetitorSelectionSnapshot(ct, id), [ct, id]),
    () => EMPTY_IDS
  );

  const matchQuery = useMatchQuery(ct, id);
  const compareQuery = useCompareQuery(ct, id, selectedIds);

  // Save match to recents whenever data loads/changes (localStorage write, no setState).
  useEffect(() => {
    if (matchQuery.data) {
      saveRecentCompetition(ct, id, matchQuery.data);
    }
  }, [ct, id, matchQuery.data]);

  function handleSelectionChange(ids: number[]) {
    saveCompetitorSelection(ct, id, ids);
    // Sync selection to URL so it can be bookmarked or shared.
    const qs = ids.length > 0 ? `?competitors=${ids.join(",")}` : "";
    router.replace(`${window.location.pathname}${qs}`, { scroll: false });
  }

  if (matchQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (matchQuery.isError || !matchQuery.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-destructive font-medium">
          {matchQuery.error?.message ?? "Failed to load match"}
        </p>
        <Button variant="outline" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>
    );
  }

  const match = matchQuery.data;

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Back link + share */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All matches
        </Link>
        <ShareButton title={match.name} />
      </div>

      {/* Match header */}
      <MatchHeader match={match} />

      {/* Stage list */}
      <StageList stages={match.stages} />

      {/* Competitor picker */}
      <div className="space-y-1">
        <p className="text-sm font-medium">Compare competitors</p>
        <CompetitorPicker
          competitors={match.competitors}
          selectedIds={selectedIds}
          onSelectionChange={handleSelectionChange}
        />
      </div>

      {/* Comparison views */}
      {selectedIds.length > 0 && (
        <div className="space-y-6">
          {compareQuery.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading comparison…
            </div>
          )}

          {compareQuery.isError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {compareQuery.error?.message ?? "Failed to load comparison"}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => compareQuery.refetch()}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {compareQuery.data && (
            <>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Stage results</h2>
                  {compareQuery.isFetching && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Refreshing…
                    </span>
                  )}
                </div>
                <ComparisonTable data={compareQuery.data} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <h2 className="font-semibold">Hit factor by stage</h2>
                <ComparisonChart data={compareQuery.data} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <h2 className="font-semibold">Speed vs. accuracy</h2>
                <p className="text-xs text-muted-foreground">
                  Time vs. points per stage. Diagonal lines show equal hit
                  factor (HF) — steeper = higher HF.
                </p>
                <SpeedAccuracyChart data={compareQuery.data} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <h2 className="font-semibold">Stage balance</h2>
                <p className="text-xs text-muted-foreground">
                  Group % per stage. A uniform polygon means consistent
                  performance; spikes show standout stages.
                </p>
                <StageBalanceChart data={compareQuery.data} />
              </div>
            </>
          )}
        </div>
      )}

      {selectedIds.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Select one or more competitors above to see the comparison.
        </p>
      )}
    </div>
  );
}
