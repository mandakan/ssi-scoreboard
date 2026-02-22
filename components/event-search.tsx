"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEventsQuery } from "@/lib/queries";
import type { EventSummary } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  on: "Open",
  cp: "Completed",
  dr: "Draft",
  cs: "Cancelled",
  pr: "Upcoming",
  ol: "Online",
};

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function EventSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const { data: events = [], isLoading } = useEventsQuery(debouncedQuery);

  function handleSelect(event: EventSummary) {
    setOpen(false);
    router.push(`/match/${event.content_type}/${event.id}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Browse IPSC competitions"
          className="w-full justify-between font-normal"
        >
          <span className="text-muted-foreground truncate">
            Browse competitions…
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name…"
            value={inputValue}
            onValueChange={setInputValue}
          />
          <CommandList>
            {isLoading ? (
              <div
                className="flex items-center justify-center py-6"
                aria-live="polite"
                aria-label="Loading competitions"
              >
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : events.length === 0 ? (
              <CommandEmpty>No competitions found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {events.map((event) => (
                  <CommandItem
                    key={event.id}
                    value={String(event.id)}
                    onSelect={() => handleSelect(event)}
                    className="flex flex-col items-start gap-0.5 py-2.5"
                  >
                    <span className="font-medium leading-snug">{event.name}</span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      {formatEventDate(event.date)}
                      {" · "}
                      {event.discipline}
                      {" · "}
                      {event.level}
                      {" · "}
                      {event.region}
                      {" · "}
                      {STATUS_LABEL[event.status] ?? event.status}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
