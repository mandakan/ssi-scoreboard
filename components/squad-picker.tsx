"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SquadInfo } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

interface SquadPickerProps {
  squads: SquadInfo[];
  selectedIds: number[];
  /** Replaces the current selection with this squad's members.
   *  The parent is responsible for capping at MAX_COMPETITORS and offering
   *  an undo affordance (so the previous selection isn't lost). */
  onReplaceSelection: (newIds: number[], squadName: string) => void;
}

export function SquadPicker({
  squads,
  selectedIds,
  onReplaceSelection,
}: SquadPickerProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(squad: SquadInfo) {
    const newIds = squad.competitorIds.slice(0, MAX_COMPETITORS);
    if (newIds.length === 0) return;
    onReplaceSelection(newIds, squad.name);
    setOpen(false);
  }

  if (squads.length === 0) return null;

  const selectedSet = new Set(selectedIds);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Replace selection with a squad"
        >
          <UsersRound className="w-4 h-4" />
          Squad
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[min(20rem,calc(100vw-2rem))]"
        align="start"
      >
        <div className="px-3 py-2 border-b">
          <p className="text-xs text-muted-foreground">
            Picking a squad replaces your current selection.
            {selectedIds.length > 0 && " You can undo right after."}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <div className="p-1">
            {squads.map((squad) => {
              const memberCount = squad.competitorIds.length;
              const tooLarge = memberCount > MAX_COMPETITORS;
              const allCurrentlySelected =
                !tooLarge &&
                memberCount === selectedIds.length &&
                squad.competitorIds.every((cid) => selectedSet.has(cid));

              return (
                <button
                  key={squad.id}
                  type="button"
                  disabled={memberCount === 0}
                  onClick={() => handleSelect(squad)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm text-left",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    allCurrentlySelected && "bg-accent/40",
                  )}
                  aria-label={
                    tooLarge
                      ? `${squad.name} (${memberCount} members — will be capped to ${MAX_COMPETITORS})`
                      : `Replace selection with ${squad.name} (${memberCount} members)`
                  }
                >
                  <span className="flex-1 truncate">
                    {squad.name}
                    <span className="ml-1 text-xs text-muted-foreground">
                      · {memberCount} member{memberCount !== 1 ? "s" : ""}
                    </span>
                  </span>
                  {tooLarge && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      first {MAX_COMPETITORS}
                    </span>
                  )}
                  {allCurrentlySelected && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
