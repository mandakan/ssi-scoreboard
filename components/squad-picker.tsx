"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SquadInfo } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

interface SquadPickerProps {
  squads: SquadInfo[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
}

export function SquadPicker({
  squads,
  selectedIds,
  onSelectionChange,
}: SquadPickerProps) {
  const [open, setOpen] = useState(false);
  // Tracks per-squad add feedback while the popover is open.
  // key = squad id, value = feedback string
  const [feedback, setFeedback] = useState<Record<number, string>>({});

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) setFeedback({});
  }

  function handleAdd(squad: SquadInfo) {
    const selectedSet = new Set(selectedIds);
    const remaining = MAX_COMPETITORS - selectedIds.length;
    const toAdd = squad.competitorIds.filter((cid) => !selectedSet.has(cid));

    if (toAdd.length === 0) return;

    const added = toAdd.slice(0, remaining);
    const nextIds = [...selectedIds, ...added];
    onSelectionChange(nextIds);

    const limitReached = added.length < toAdd.length;
    const msg = limitReached
      ? `Added ${added.length} of ${toAdd.length} — limit reached`
      : `Added ${added.length}`;
    setFeedback((prev) => ({ ...prev, [squad.id]: msg }));
  }

  if (squads.length === 0) return null;

  const selectedSet = new Set(selectedIds);
  const remaining = MAX_COMPETITORS - selectedIds.length;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Add squad"
        >
          <UsersRound className="w-4 h-4" />
          Add squad
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[min(20rem,calc(100vw-2rem))]"
        align="start"
      >
        <div className="max-h-72 overflow-y-auto">
          <div className="p-1">
            {squads.length === 0 ? (
              <p className="py-3 px-3 text-sm text-muted-foreground text-center">
                No squads found
              </p>
            ) : (
              squads.map((squad) => {
                const memberCount = squad.competitorIds.length;
                const tooLarge = memberCount > MAX_COMPETITORS;
                const allSelected =
                  !tooLarge &&
                  squad.competitorIds.every((cid) => selectedSet.has(cid));
                const hasFeedback = Boolean(feedback[squad.id]);
                const isAddable =
                  !tooLarge && !allSelected && remaining > 0;

                return (
                  <div
                    key={squad.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm",
                      tooLarge && "opacity-50"
                    )}
                  >
                    <span className="flex-1 truncate">
                      {squad.name}
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {memberCount} member{memberCount !== 1 ? "s" : ""}
                      </span>
                    </span>

                    {tooLarge ? (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Exceeds {MAX_COMPETITORS}-competitor limit
                      </span>
                    ) : allSelected ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                        <Check className="w-3 h-3" aria-hidden="true" />
                        All added
                      </span>
                    ) : hasFeedback ? (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {feedback[squad.id]}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!isAddable}
                        aria-label={`Add ${squad.name}`}
                        onClick={() => handleAdd(squad)}
                      >
                        Add
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
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
