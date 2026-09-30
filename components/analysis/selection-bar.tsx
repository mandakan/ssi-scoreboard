"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle, XCircle } from "lucide-react";
import { CompetitorPicker } from "@/components/competitor-picker";
import { SquadPicker } from "@/components/squad-picker";
import { BenchmarkPicker } from "@/components/benchmark-picker";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { UndoBanner } from "@/components/analysis/undo-banner";
import { MAX_COMPETITORS } from "@/lib/constants";
import { selectionSummary } from "@/lib/selection-summary";
import type { FieldFingerprintPoint, MatchResponse } from "@/lib/types";

interface SelectionBarProps {
  match: MatchResponse;
  selectedIds: number[];
  gridRows: number[];
  identityShooterId: number | null;
  trackedIds: Set<number>;
  fieldFingerprintPoints: FieldFingerprintPoint[];
  benchmarkDisabled: boolean;
  trackedInMatch: { present: number; total: number } | null;
  onSelectionChange: (ids: number[]) => void;
  onReplaceSelection: (ids: number[], message: string) => void;
  onSetMyIdentity: (c: { shooterId: number | null; name: string }) => void;
  onToggleTracked: (c: {
    shooterId: number | null;
    name: string;
    club: string | null;
    division: string | null;
  }) => void;
  onManage: () => void;
  /** Pending bulk-change undo, mirrored inside the sheet so it stays reachable. */
  pendingUndo: { message: string } | null;
  onUndo: () => void;
}

/**
 * One-row summary of who is being compared. Tapping it opens a bottom sheet
 * holding the pickers. Purely presentational: no queries, all data comes in
 * through props.
 */
export function SelectionBar({
  match,
  selectedIds,
  gridRows,
  identityShooterId,
  trackedIds,
  fieldFingerprintPoints,
  benchmarkDisabled,
  trackedInMatch,
  onSelectionChange,
  onReplaceSelection,
  onSetMyIdentity,
  onToggleTracked,
  onManage,
  pendingUndo,
  onUndo,
}: SelectionBarProps) {
  const [open, setOpen] = useState(false);

  const byId = new Map(match.competitors.map((c) => [c.id, c.name]));
  const names = selectedIds
    .map((id) => byId.get(id))
    .filter((n): n is string => n !== undefined);
  const summary = selectionSummary(names);

  return (
    <div>
      <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm"
        >
          <span className="min-w-0">
            <span className="block truncate">
              {summary ? `Comparing: ${summary}` : "Choose shooters to compare"}
            </span>
            {trackedInMatch && trackedInMatch.total > 0 && (
              <span className="block text-xs text-muted-foreground">
                {trackedInMatch.present} of {trackedInMatch.total} tracked
              </span>
            )}
          </span>
          <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
        </button>
      </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>Who to compare</SheetTitle>
            <SheetDescription>
              Mix and match up to {MAX_COMPETITORS} competitors. Your favorites and &ldquo;you&rdquo; appear at the top of the picker.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium">Compare competitors</p>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    aria-label="How competitor selection works"
                  >
                    <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
                  <PopoverHeader>
                    <PopoverTitle>Picking who to compare</PopoverTitle>
                    <PopoverDescription>
                      Mix and match up to {MAX_COMPETITORS} competitors. Your favorites and &ldquo;you&rdquo; appear at the top of the picker.
                    </PopoverDescription>
                  </PopoverHeader>
                  <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                    <p><strong>Star</strong> — favorite a competitor. Stars live in the picker, in the comparison table header, and on the shooter dashboard. The picker also has an &ldquo;Add all favorites&rdquo; pill so you can pull in everyone you track in one tap.</p>
                    <p><strong>Squad</strong> — replaces your selection with everyone in a squad. One tap to undo.</p>
                    <p><strong>Benchmark</strong> — once you set &ldquo;this is me&rdquo; in My Shooters, you unlock one-tap presets: one-above, one-below, division podium, percentile cohort, and same-club peers.</p>
                    <p><strong>Reorder</strong> — use the chevrons in each comparison-table column header to move a competitor left or right. Their column color follows the new position.</p>
                    <p><strong>Clear</strong> — wipes the selection. Undo lasts 5 seconds.</p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-start gap-2 flex-wrap">
              <CompetitorPicker
                competitors={match.competitors}
                selectedIds={selectedIds}
                onSelectionChange={onSelectionChange}
                myShooterId={identityShooterId}
                trackedShooterIds={trackedIds}
                onSetMyIdentity={onSetMyIdentity}
                onToggleTracked={onToggleTracked}
                onManage={() => {
                  setOpen(false);
                  onManage();
                }}
              />
              {match.squads.length > 0 && (
                <SquadPicker
                  squads={match.squads}
                  selectedIds={selectedIds}
                  onReplaceSelection={(ids, squadName) =>
                    onReplaceSelection(ids, `Replaced selection with ${squadName}`)
                  }
                />
              )}
              {selectedIds.length > 0 && (
                <BenchmarkPicker
                  fieldFingerprintPoints={fieldFingerprintPoints}
                  competitors={match.competitors}
                  selectedIds={selectedIds}
                  onSelectionChange={onSelectionChange}
                  myShooterId={identityShooterId}
                  onReplaceSelection={onReplaceSelection}
                  disabled={benchmarkDisabled}
                />
              )}
              {selectedIds.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    onReplaceSelection([], `Cleared ${selectedIds.length} selected`)
                  }
                  aria-label="Clear all selected competitors"
                >
                  <XCircle className="w-4 h-4" aria-hidden="true" />
                  Clear
                </Button>
              )}
            </div>
            {gridRows.length > 0 && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  onReplaceSelection(
                    gridRows.slice(0, MAX_COMPETITORS),
                    "Reset to grid shooters",
                  )
                }
              >
                Reset to grid shooters
              </Button>
            )}
            {pendingUndo && (
              <UndoBanner message={pendingUndo.message} onUndo={onUndo} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
