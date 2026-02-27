"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, Trophy } from "lucide-react";
import type { CompetitorInfo, FieldFingerprintPoint } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

const TOP_N = 3;
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

interface BenchmarkPickerProps {
  fieldFingerprintPoints: FieldFingerprintPoint[];
  competitors: CompetitorInfo[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  /** When true the trigger button is shown in a disabled state (e.g. while data is loading). */
  disabled?: boolean;
}

export function BenchmarkPicker({
  fieldFingerprintPoints,
  competitors,
  selectedIds,
  onSelectionChange,
  disabled = false,
}: BenchmarkPickerProps) {
  const [open, setOpen] = useState(false);
  const [selectedDivision, setSelectedDivision] = useState<string>("");

  const divisions = [
    ...new Set(fieldFingerprintPoints.map((p) => p.division).filter(Boolean)),
  ].sort() as string[];

  if (divisions.length === 0 && !disabled) return null;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      // Default to the division of the first selected competitor, otherwise the first division.
      const firstDiv =
        selectedIds.length > 0
          ? (fieldFingerprintPoints.find((p) => p.competitorId === selectedIds[0])
              ?.division ?? null)
          : null;
      setSelectedDivision(firstDiv ?? divisions[0] ?? "");
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
        className="p-0 w-[min(20rem,calc(100vw-2rem))]"
        align="start"
      >
        <div className="p-3 border-b">
          <label
            htmlFor="benchmark-division-select"
            className="text-xs font-medium text-muted-foreground block mb-1.5"
          >
            Division
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
