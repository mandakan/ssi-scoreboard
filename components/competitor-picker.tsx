"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Users, Check, Star, User, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompetitorInfo } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

interface CompetitorPickerProps {
  competitors: CompetitorInfo[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
  /** ShooterId of the user's claimed identity. */
  myShooterId?: number | null;
  /** Set of shooter IDs the user is tracking. */
  trackedShooterIds?: Set<number>;
  /** Called when user clicks the identity (User) button on a row. */
  onSetMyIdentity?: (c: CompetitorInfo) => void;
  /** Called when user clicks the star button on a row. */
  onToggleTracked?: (c: CompetitorInfo) => void;
  /** Called when user clicks "Manage tracked" in the footer. */
  onManage?: () => void;
}

export function CompetitorPicker({
  competitors,
  selectedIds,
  onSelectionChange,
  myShooterId,
  trackedShooterIds,
  onSetMyIdentity,
  onToggleTracked,
  onManage,
}: CompetitorPickerProps) {
  const [open, setOpen] = useState(false);

  const selectedSet = new Set(selectedIds);
  const hasTracking = onSetMyIdentity !== undefined || onToggleTracked !== undefined;

  function toggle(id: number) {
    if (selectedSet.has(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else if (selectedIds.length < MAX_COMPETITORS) {
      onSelectionChange([...selectedIds, id]);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Users className="w-4 h-4" />
            Add competitor
            {selectedIds.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {selectedIds.length}/{MAX_COMPETITORS}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[min(22rem,calc(100vw-2rem))]" align="start">
          <Command>
            <CommandInput aria-label="Search competitors" placeholder="Search by name, number, or club…" />
            <CommandList>
              <CommandEmpty>No competitors found.</CommandEmpty>
              <CommandGroup>
                {competitors.map((c) => {
                  const isSelected = selectedSet.has(c.id);
                  const isDisabled = !isSelected && selectedIds.length >= MAX_COMPETITORS;
                  const isTracked = trackedShooterIds?.has(c.shooterId ?? -1) ?? false;
                  const isMe = c.shooterId !== null && c.shooterId === myShooterId;
                  const hasShooterId = c.shooterId !== null;

                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.competitor_number} ${c.name} ${c.club ?? ""}`}
                      onSelect={() => toggle(c.id)}
                      disabled={isDisabled}
                      className={cn(
                        "flex items-center gap-2 pr-1",
                        isDisabled && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <Check
                        className={cn(
                          "w-4 h-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="font-mono text-xs text-muted-foreground w-8 shrink-0">
                        #{c.competitor_number}
                      </span>
                      <span className="flex-1 truncate min-w-0">{c.name}</span>

                      {hasTracking ? (
                        /* Tracking action buttons — only shown when tracking props provided */
                        <span className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {onToggleTracked && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleTracked(c);
                              }}
                              disabled={!hasShooterId}
                              aria-label={isTracked ? `Untrack ${c.name}` : `Track ${c.name}`}
                              className={cn(
                                "p-2 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                hasShooterId
                                  ? isTracked
                                    ? "text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                                    : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10"
                                  : "text-muted-foreground/30 cursor-not-allowed"
                              )}
                            >
                              <Star
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                                fill={isTracked ? "currentColor" : "none"}
                              />
                            </button>
                          )}
                          {onSetMyIdentity && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSetMyIdentity(c);
                              }}
                              disabled={!hasShooterId}
                              aria-label={`Set as my identity: ${c.name}`}
                              className={cn(
                                "p-2 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                                hasShooterId
                                  ? isMe
                                    ? "text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                                    : "text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10"
                                  : "text-muted-foreground/30 cursor-not-allowed"
                              )}
                            >
                              <User
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                                fill={isMe ? "currentColor" : "none"}
                              />
                            </button>
                          )}
                        </span>
                      ) : (
                        /* No tracking props — show club as before */
                        c.club && (
                          <span className="text-xs text-muted-foreground truncate max-w-20">
                            {c.club}
                          </span>
                        )
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            {onManage && (
              <div className="border-t p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onManage();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Manage tracked shooters
                </button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
      {selectedIds.length >= MAX_COMPETITORS && (
        <p className="text-xs text-muted-foreground">
          Maximum {MAX_COMPETITORS} competitors selected.
        </p>
      )}
    </>
  );
}
