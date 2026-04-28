"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Award,
  Check,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CompetitorInfo, FieldFingerprintPoint } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";
import {
  computeSmartPresets,
  type SmartPreset,
  type SmartPresetKind,
} from "@/lib/benchmark-presets";

const TOP_N = 3;
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

const PRESET_ICONS: Record<SmartPresetKind, LucideIcon> = {
  "one-above": ArrowUpToLine,
  "one-below": ArrowDownToLine,
  podium: Trophy,
  percentile: Award,
  "same-club": Users,
};

interface BenchmarkPickerProps {
  fieldFingerprintPoints: FieldFingerprintPoint[];
  competitors: CompetitorInfo[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  /** ShooterId of the user's "this is me" identity. Required for smart presets. */
  myShooterId?: number | null;
  /** Replaces the current selection. Used by smart presets so the user can undo. */
  onReplaceSelection?: (newIds: number[], message: string) => void;
  /** When true the trigger button is shown in a disabled state (e.g. while data is loading). */
  disabled?: boolean;
}

export function BenchmarkPicker({
  fieldFingerprintPoints,
  competitors,
  selectedIds,
  onSelectionChange,
  myShooterId,
  onReplaceSelection,
  disabled = false,
}: BenchmarkPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedDivision, setSelectedDivision] = useState<string>("");

  const divisions = [
    ...new Set(fieldFingerprintPoints.map((p) => p.division).filter(Boolean)),
  ].sort() as string[];

  // Smart presets — only available when "this is me" is set and the user is
  // entered in this match.
  const myCompetitor = useMemo(
    () =>
      myShooterId != null
        ? competitors.find((c) => c.shooterId === myShooterId) ?? null
        : null,
    [competitors, myShooterId],
  );
  const myPoint = useMemo(
    () =>
      myCompetitor
        ? fieldFingerprintPoints.find((p) => p.competitorId === myCompetitor.id) ?? null
        : null,
    [fieldFingerprintPoints, myCompetitor],
  );
  const smartPresets = useMemo(() => {
    if (!myCompetitor || !myPoint || !onReplaceSelection) return [];
    return computeSmartPresets({
      myCompetitor,
      myPoint,
      competitors,
      fieldFingerprintPoints,
    });
  }, [myCompetitor, myPoint, competitors, fieldFingerprintPoints, onReplaceSelection]);

  if (divisions.length === 0 && smartPresets.length === 0 && !disabled) return null;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // Default to the user's division when set, else the first selected
      // competitor's division, else the first division.
      const myDiv = myPoint?.division ?? null;
      const firstSelectedDiv =
        selectedIds.length > 0
          ? (fieldFingerprintPoints.find((p) => p.competitorId === selectedIds[0])
              ?.division ?? null)
          : null;
      setSelectedDivision(myDiv ?? firstSelectedDiv ?? divisions[0] ?? "");
    }
    setOpen(nextOpen);
  }

  const competitorMap = new Map(competitors.map((c) => [c.id, c]));

  const topN = fieldFingerprintPoints
    .filter((p) => p.division === selectedDivision && p.actualDivRank !== null)
    .sort((a, b) => (a.actualDivRank ?? Infinity) - (b.actualDivRank ?? Infinity))
    .slice(0, TOP_N);

  const selectedSet = new Set(selectedIds);
  const remaining = MAX_COMPETITORS - selectedIds.length;

  function handleToggle(competitorId: number) {
    if (selectedSet.has(competitorId)) {
      onSelectionChange(selectedIds.filter((id) => id !== competitorId));
    } else {
      if (remaining <= 0) return;
      onSelectionChange([...selectedIds, competitorId]);
    }
  }

  function handleApplyPreset(preset: SmartPreset) {
    if (!onReplaceSelection) return;
    onReplaceSelection(preset.ids, `Applied benchmark: ${preset.label}`);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
          aria-label="Add benchmark competitor"
        >
          <Trophy className="w-4 h-4" aria-hidden="true" />
          Benchmark
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[min(22rem,calc(100vw-2rem))] max-h-[80vh] overflow-y-auto"
        align="start"
      >
        {smartPresets.length > 0 && (
          <section
            aria-labelledby="benchmark-smart-heading"
            className="border-b"
          >
            <h3
              id="benchmark-smart-heading"
              className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Smart presets
            </h3>
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Replaces your selection. Tap Undo to restore.
            </p>
            <ul className="p-1">
              {smartPresets.map((preset) => {
                const Icon = PRESET_ICONS[preset.kind];
                return (
                <li key={preset.kind}>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    className="w-full flex items-start gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    aria-label={`${preset.label}. ${preset.description}. Replaces current selection with ${preset.ids.length} competitors.`}
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium leading-snug">
                        {preset.label}
                      </span>
                      <span className="block text-xs text-muted-foreground leading-snug truncate">
                        {preset.description}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">
                      {preset.ids.length}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          </section>
        )}
        {smartPresets.length === 0 && myShooterId == null && (
          <div className="px-3 pt-3 pb-2 border-b text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              Smart presets locked
            </p>
            <p>
              Set &ldquo;this is me&rdquo; in My Shooters to unlock one-tap
              benchmarks like &ldquo;one above me&rdquo; and &ldquo;my
              percentile cohort&rdquo;.
            </p>
          </div>
        )}
        <div className="p-3 border-b">
          <label
            htmlFor="benchmark-division-select"
            className="text-xs font-medium text-muted-foreground block mb-1.5"
          >
            Top 3 in division
          </label>
          <select
            id="benchmark-division-select"
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {divisions.map((div) => (
              <option key={div} value={div}>
                {div}
              </option>
            ))}
          </select>
        </div>
        <div className="p-1">
          {topN.length === 0 ? (
            <p className="py-3 px-3 text-sm text-muted-foreground text-center">
              No ranked competitors in this division
            </p>
          ) : (
            topN.map((point, index) => {
              const comp = competitorMap.get(point.competitorId);
              const isSelected = selectedSet.has(point.competitorId);
              const canAdd = !isSelected && remaining > 0;

              return (
                <div
                  key={point.competitorId}
                  className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm"
                >
                  <span className="w-7 text-xs text-muted-foreground tabular-nums shrink-0">
                    {ORDINALS[index] ?? `${index + 1}.`}
                  </span>
                  <span className="flex-1 truncate min-w-0">
                    <span className="block truncate">
                      {comp?.name ?? `#${point.competitorId}`}
                    </span>
                    {comp?.club && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {comp.club}
                      </span>
                    )}
                  </span>
                  {isSelected ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap shrink-0"
                      aria-label="Already added"
                    >
                      <Check className="w-3 h-3" aria-hidden="true" />
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={!canAdd}
                      aria-label={`Add ${comp?.name ?? `competitor ${point.competitorId}`}`}
                      onClick={() => handleToggle(point.competitorId)}
                    >
                      Add
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {remaining > 0
              ? `${remaining} slot${remaining !== 1 ? "s" : ""} remaining`
              : `Limit of ${MAX_COMPETITORS} reached`}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
