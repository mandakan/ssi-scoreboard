"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useEventsQuery } from "@/lib/queries";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { EventSummary } from "@/lib/types";
import { parseMatchUrl, cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  on: "Open",
  cp: "Completed",
  dr: "Draft",
  cs: "Cancelled",
  pr: "Upcoming",
  ol: "Online",
};

const FIREARMS_OPTIONS = [
  { id: "all", label: "All" },
  { id: "hg", label: "Handgun & PCC" },
  { id: "pc", label: "PCC" },
  { id: "rf", label: "Rifle" },
  { id: "sg", label: "Shotgun" },
] as const;

const COUNTRY_OPTIONS = [
  { id: "all", label: "All" },
  { id: "SWE", label: "Sweden" },
  { id: "NOR", label: "Norway" },
  { id: "DNK", label: "Denmark" },
  { id: "FIN", label: "Finland" },
] as const;

const LEVEL_OPTIONS = [
  { id: "all",    label: "All"  },
  { id: "l2plus", label: "L2+" },
  { id: "l3plus", label: "L3+" },
  { id: "l4plus", label: "L4+" },
] as const;

// ── Filter persistence ────────────────────────────────────────────────────────

const LS_FILTERS_KEY = "ssi_event_filters";

interface StoredFilters {
  level: string;
  firearms: string;
  country: string;
}

/** Best-effort country guess for first-time visitors. Returns one of the
 *  COUNTRY_OPTIONS ids or "all" as a fallback. Only called client-side.
 *
 *  Strategy: timezone first (reliable even for English-locale users), then
 *  language locale as a secondary signal, then "all". Nothing leaves the
 *  device — both Intl and navigator.language are read-only system settings. */
function guessCountry(): string {
  // 1. Timezone — most reliable: a Swedish user with English locale still has
  //    "Europe/Stockholm" set in their OS.
  if (typeof Intl !== "undefined") {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Europe/Stockholm") return "SWE";
    if (tz === "Europe/Oslo") return "NOR";
    if (tz === "Europe/Copenhagen") return "DNK";
    if (tz === "Europe/Helsinki" || tz === "Europe/Mariehamn") return "FIN";
  }
  // 2. Language locale — weaker signal but catches remaining cases.
  if (typeof navigator !== "undefined") {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("sv")) return "SWE";
    if (lang.startsWith("no") || lang.startsWith("nb") || lang.startsWith("nn")) return "NOR";
    if (lang.startsWith("da")) return "DNK";
    if (lang.startsWith("fi")) return "FIN";
  }
  return "all";
}

// ── Filter store (useSyncExternalStore pattern) ───────────────────────────────

const _filterListeners = new Set<() => void>();
let _filterCache: StoredFilters | null = null;

function _getFilterSnapshot(): StoredFilters {
  if (_filterCache === null) {
    try {
      const raw = localStorage.getItem(LS_FILTERS_KEY);
      const stored = raw ? (JSON.parse(raw) as StoredFilters) : null;
      _filterCache = stored ?? { firearms: "all", country: guessCountry(), level: "all" };
    } catch {
      _filterCache = { firearms: "all", country: "all", level: "all" };
    }
  }
  return _filterCache;
}

const _serverFilterSnapshot: StoredFilters = { firearms: "all", country: "all", level: "all" };

function _subscribeToFilters(cb: () => void): () => void {
  _filterListeners.add(cb);
  return () => _filterListeners.delete(cb);
}

function updateFilters(patch: Partial<StoredFilters>): void {
  _filterCache = { ..._getFilterSnapshot(), ...patch };
  try {
    localStorage.setItem(LS_FILTERS_KEY, JSON.stringify(_filterCache));
  } catch { /* ignore private-browsing write failures */ }
  _filterListeners.forEach((cb) => cb());
}

// ── Pure date helpers ────────────────────────────────────────────────────────

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

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

// ── Chip button shared style ─────────────────────────────────────────────────

function chipClass(active: boolean) {
  return cn(
    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground hover:bg-muted/80",
  );
}

// ── Wide date range used in search mode ─────────────────────────────────────

const WIDE_AFTER = "2010-01-01";
const WIDE_BEFORE = toISODate(addMonths(new Date(), 60));

// ── Component ────────────────────────────────────────────────────────────────

export function EventSearch() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [browseMonth, setBrowseMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { firearms, country, level } = useSyncExternalStore(
    _subscribeToFilters,
    _getFilterSnapshot,
    () => _serverFilterSnapshot,
  );
  function setFirearms(v: string) { updateFilters({ firearms: v }); }
  function setCountry(v: string)  { updateFilters({ country: v });  }
  function setLevel(v: string)    { updateFilters({ level: v });    }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputValue), 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  function handleInputChange(value: string) {
    const trimmed = value.trim();
    if (trimmed.startsWith("http")) {
      const parsed = parseMatchUrl(trimmed);
      if (parsed) {
        router.push(`/match/${parsed.ct}/${parsed.id}`);
        return;
      }
    }
    setInputValue(value);
  }

  const isBrowseMode = debouncedQuery.trim() === "";

  const starts_after  = isBrowseMode ? toISODate(startOfMonth(browseMonth)) : WIDE_AFTER;
  const starts_before = isBrowseMode ? toISODate(endOfMonth(browseMonth))   : WIDE_BEFORE;

  const { data: events = [], isLoading } = useEventsQuery(
    debouncedQuery,
    starts_after,
    starts_before,
    firearms,
    country,
    level,
  );

  function handleSelect(event: EventSummary) {
    router.push(`/match/${event.content_type}/${event.id}`);
  }

  // Active filter summary shown in collapsed filter button — omit "all" values
  const activeFilterSummary = [
    country   !== "all" ? COUNTRY_OPTIONS.find((o)  => o.id === country)?.label   : null,
    level     !== "all" ? LEVEL_OPTIONS.find((o)    => o.id === level)?.label     : null,
    firearms  !== "all" ? FIREARMS_OPTIONS.find((o) => o.id === firearms)?.label  : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const prevMonth = addMonths(browseMonth, -1);
  const nextMonth = addMonths(browseMonth, 1);

  return (
    <section aria-label="Find competitions">
      <Command shouldFilter={false} className="rounded-lg border shadow-sm">
        <CommandInput
          placeholder="Search by name or paste a match URL…"
          value={inputValue}
          onValueChange={handleInputChange}
        />

        {/* ── Collapsible filter panel ── */}
        <div className="border-t px-3 py-2">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="event-search-filter-panel"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              "flex w-full items-center gap-1.5 text-xs text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
            )}
          >
            <span className="font-medium">Filters</span>
            {activeFilterSummary && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{activeFilterSummary}</span>
              </>
            )}
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
                filtersOpen && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>

          {filtersOpen && (
            <div
              id="event-search-filter-panel"
              role="region"
              aria-label="Filters"
              className="mt-2 space-y-2"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">Discipline</span>
                <ToggleGroup
                  type="single"
                  value={firearms}
                  onValueChange={(v) => { if (v) setFirearms(v); }}
                  aria-label="Discipline"
                  className="w-auto flex gap-1.5 flex-wrap"
                >
                  {FIREARMS_OPTIONS.map(({ id, label }) => (
                    <ToggleGroupItem
                      key={id}
                      value={id}
                      className={cn("h-auto min-w-0", chipClass(id === firearms))}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">Country</span>
                <ToggleGroup
                  type="single"
                  value={country}
                  onValueChange={(v) => { if (v) setCountry(v); }}
                  aria-label="Country"
                  className="w-auto flex gap-1.5 flex-wrap"
                >
                  {COUNTRY_OPTIONS.map(({ id, label }) => (
                    <ToggleGroupItem
                      key={id}
                      value={id}
                      className={cn("h-auto min-w-0", chipClass(id === country))}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">Level</span>
                <ToggleGroup
                  type="single"
                  value={level}
                  onValueChange={(v) => { if (v) setLevel(v); }}
                  aria-label="Level"
                  className="w-auto flex gap-1.5 flex-wrap"
                >
                  {LEVEL_OPTIONS.map(({ id, label }) => (
                    <ToggleGroupItem
                      key={id}
                      value={id}
                      className={cn("h-auto min-w-0", chipClass(id === level))}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
          )}
        </div>

        {/* ── Mode callout ── */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "flex flex-col gap-0.5 border-t px-3 py-2 text-sm",
            isBrowseMode ? "bg-muted/50" : "bg-primary/5",
          )}
        >
          {isBrowseMode ? (
            <>
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  Browsing <strong>{formatMonthYear(browseMonth)}</strong>
                </span>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Showing matches in this month · use the arrows to navigate
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  Searching <strong>all dates</strong>
                </span>
              </div>
              <p className="text-xs text-muted-foreground pl-5">
                Month filter paused ·{" "}
                <button
                  type="button"
                  onClick={() => setInputValue("")}
                  className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  Clear search to browse
                </button>
              </p>
            </>
          )}
        </div>

        {/* ── Month navigator ── */}
        <div
          aria-label="Browse by month"
          aria-disabled={!isBrowseMode}
          className={cn(
            "flex items-center justify-between border-t px-4 py-2",
            !isBrowseMode && "pointer-events-none opacity-40",
          )}
        >
          <button
            type="button"
            aria-label={`Previous month: ${formatMonthYear(prevMonth)}`}
            tabIndex={isBrowseMode ? 0 : -1}
            onClick={() => setBrowseMonth((m) => startOfMonth(addMonths(m, -1)))}
            className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="text-sm font-medium">{formatMonthYear(browseMonth)}</span>
          <button
            type="button"
            aria-label={`Next month: ${formatMonthYear(nextMonth)}`}
            tabIndex={isBrowseMode ? 0 : -1}
            onClick={() => setBrowseMonth((m) => startOfMonth(addMonths(m, 1)))}
            className="rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* ── Results ── */}
        <CommandList className="max-h-[50vh]">
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
    </section>
  );
}
