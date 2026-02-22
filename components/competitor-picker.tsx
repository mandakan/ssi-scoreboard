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
import { Users, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompetitorInfo } from "@/lib/types";

const MAX_SELECTED = 10;

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
    } else if (selectedIds.length < MAX_SELECTED) {
      onSelectionChange([...selectedIds, id]);
    }
  }

  function remove(id: number) {
    onSelectionChange(selectedIds.filter((s) => s !== id));
  }

  const selectedCompetitors = selectedIds
    .map((id) => competitors.find((c) => c.id === id))
    .filter(Boolean) as CompetitorInfo[];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Users className="w-4 h-4" />
              Add competitor
              {selectedIds.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {selectedIds.length}/{MAX_SELECTED}
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
                    const isDisabled = !isSelected && selectedIds.length >= MAX_SELECTED;
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

        {selectedCompetitors.map((c) => (
          <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
            <span className="font-mono text-xs">#{c.competitor_number}</span>
            <span>{c.name}</span>
            <button
              onClick={() => remove(c.id)}
              className="ml-1 rounded-sm hover:bg-muted p-0.5"
              aria-label={`Remove ${c.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      {selectedIds.length >= MAX_SELECTED && (
        <p className="text-xs text-muted-foreground">
          Maximum {MAX_SELECTED} competitors selected.
        </p>
      )}
    </div>
  );
}
