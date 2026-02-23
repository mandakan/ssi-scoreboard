"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
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
import { parseMatchUrl } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  on: "Open",
  cp: "Completed",
  dr: "Draft",
  cs: "Cancelled",
  pr: "Upcoming",
  ol: "Online",
};

type DatePreset = {
  label: string;
  after: (now: Date) => Date;
  before: (now: Date) => Date;
};

const DATE_PRESETS: { id: string; label: string; preset: DatePreset }[] = [
  {
    id: "upcoming",
    label: "Upcoming",
    preset: {
      label: "Upcoming",
      after: (now) => now,
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 6);
        return d;
      },
    },
  },
  {
    id: "3months",
    label: "3 months",
    preset: {
      label: "3 months",
      after: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 3);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
  {
    id: "6months",
    label: "6 months",
    preset: {
      label: "6 months",
      after: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 6);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
  {
    id: "1year",
    label: "1 year",
    preset: {
      label: "1 year",
      after: (now) => {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 1);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
  {
    id: "2years",
    label: "2 years",
    preset: {
      label: "2 years",
      after: (now) => {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 2);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
  {
    id: "3years",
    label: "3 years",
    preset: {
      label: "3 years",
      after: (now) => {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 3);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
  {
    id: "5years",
    label: "5 years",
    preset: {
      label: "5 years",
      after: (now) => {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() - 5);
        return d;
      },
      before: (now) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() + 3);
        return d;
      },
    },
  },
];

const DEFAULT_PRESET_ID = "3months";

const FIREARMS_OPTIONS = [
  { id: "hg", label: "Handgun & PCC" },
  { id: "pc", label: "PCC" },
  { id: "rf", label: "Rifle" },
  { id: "sg", label: "Shotgun" },
] as const;

const DEFAULT_FIREARMS = "hg";

const COUNTRY_OPTIONS = [
  { id: "all", label: "All" },
  { id: "SWE", label: "Sweden" },
  { id: "NOR", label: "Norway" },
  { id: "DNK", label: "Denmark" },
  { id: "FIN", label: "Finland" },
] as const;

const DEFAULT_COUNTRY = "SWE";

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

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
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [firearms, setFirearms] = useState(DEFAULT_FIREARMS);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  function handleInputChange(value: string) {
    // Smart URL detection — pasting a match URL navigates directly
    const trimmed = value.trim();
    if (trimmed.startsWith("http")) {
      const parsed = parseMatchUrl(trimmed);
      if (parsed) {
        setOpen(false);
        router.push(`/match/${parsed.ct}/${parsed.id}`);
        return;
      }
    }
    setInputValue(value);
  }

  const now = new Date();
  const selected = DATE_PRESETS.find((p) => p.id === presetId)!;
  const starts_after = toISODate(selected.preset.after(now));
  const starts_before = toISODate(selected.preset.before(now));

  const { data: events = [], isLoading } = useEventsQuery(
    debouncedQuery,
    starts_after,
    starts_before,
    firearms,
    country,
  );

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
          aria-label="Search IPSC competitions"
          className="w-full justify-start font-normal gap-2"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground truncate">
            Find your match…
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        {/* Filters */}
        <div className="px-3 py-2 border-b space-y-2">
          <div role="group" aria-label="Date range" className="flex gap-1.5 flex-wrap">
            {DATE_PRESETS.map(({ id, label }) => {
              const active = id === presetId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPresetId(id)}
                  className={[
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Firearms" className="flex gap-1.5 flex-wrap">
            {FIREARMS_OPTIONS.map(({ id, label }) => {
              const active = id === firearms;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFirearms(id)}
                  className={[
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Country" className="flex gap-1.5 flex-wrap">
            {COUNTRY_OPTIONS.map(({ id, label }) => {
              const active = id === country;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCountry(id)}
                  className={[
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or paste a match URL…"
            value={inputValue}
            onValueChange={handleInputChange}
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
