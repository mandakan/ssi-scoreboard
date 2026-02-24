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
import { Users, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompetitorInfo } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

interface CompetitorPickerProps {
  competitors: CompetitorInfo[];
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
}

export function CompetitorPicker({
  competitors,
  selectedIds,
  onSelectionChange,
}: CompetitorPickerProps) {
  const [open, setOpen] = useState(false);

  const selectedSet = new Set(selectedIds);

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
        <PopoverContent className="p-0 w-[min(18rem,calc(100vw-2rem))]" align="start">
          <Command>
            <CommandInput placeholder="Search by name, number, or club…" />
            <CommandList>
              <CommandEmpty>No competitors found.</CommandEmpty>
              <CommandGroup>
                {competitors.map((c) => {
                  const isSelected = selectedSet.has(c.id);
                  const isDisabled = !isSelected && selectedIds.length >= MAX_COMPETITORS;
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.competitor_number} ${c.name} ${c.club ?? ""}`}
                      onSelect={() => toggle(c.id)}
                      disabled={isDisabled}
                      className={cn(
                        "flex items-center gap-2",
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
                      <span className="flex-1 truncate">{c.name}</span>
                      {c.club && (
                        <span className="text-xs text-muted-foreground truncate max-w-20">
                          {c.club}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
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
