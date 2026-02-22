"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MatchHeader } from "@/components/match-header";
import { CompetitorPicker } from "@/components/competitor-picker";
import { ComparisonTable } from "@/components/comparison-table";
import { ComparisonChart } from "@/components/comparison-chart";
import { useMatchQuery, useCompareQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";

export default function MatchPage() {
  const params = useParams<{ ct: string; id: string }>();
  const { ct, id } = params;

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const matchQuery = useMatchQuery(ct, id);
  const compareQuery = useCompareQuery(ct, id, selectedIds);

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
    <div className="min-h-screen p-6 max-w-6xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All matches
      </Link>

      {/* Match header */}
      <MatchHeader match={match} />

      {/* Competitor picker */}
      <div className="space-y-1">
        <p className="text-sm font-medium">Compare competitors</p>
        <CompetitorPicker
          competitors={match.competitors}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
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
                <h2 className="font-semibold">Points by stage</h2>
                <ComparisonChart data={compareQuery.data} />
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
