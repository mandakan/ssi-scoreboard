"use client";

import { useState, useEffect } from "react";
import { X, User, Star, UserCheck, ExternalLink, Loader2, Search } from "lucide-react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { useShooterSearchQuery } from "@/lib/queries";
import type { ShooterSearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TrackedShootersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatRelativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ── Search result row ─────────────────────────────────────────────────────────

interface SearchResultRowProps {
  result: ShooterSearchResult;
  isTracked: boolean;
  isMe: boolean;
  onToggleTracked: () => void;
  onToggleMe: () => void;
  onNavigate: () => void;
}

function SearchResultRow({
  result,
  isTracked,
  isMe,
  onToggleTracked,
  onToggleMe,
  onNavigate,
}: SearchResultRowProps) {
  const subtitle = [result.division, result.club].filter(Boolean).join(" · ");
  const lastSeen = result.lastSeen ? formatRelativeDate(result.lastSeen) : null;

  return (
    <li className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate">{result.name}</p>
        {(subtitle || lastSeen) && (
          <p className="text-xs text-muted-foreground leading-snug truncate">
            {[subtitle, lastSeen].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Track toggle */}
      <button
        type="button"
        onClick={onToggleTracked}
        aria-pressed={isTracked}
        aria-label={isTracked ? `Untrack ${result.name}` : `Track ${result.name}`}
        className={cn(
          "shrink-0 rounded p-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isTracked
            ? "text-amber-500 hover:text-amber-600"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Star
          className={cn("h-4 w-4", isTracked && "fill-current")}
          aria-hidden="true"
        />
      </button>

      {/* "This is me" toggle */}
      <button
        type="button"
        onClick={onToggleMe}
        aria-pressed={isMe}
        aria-label={isMe ? "Clear 'this is me'" : `Set ${result.name} as 'this is me'`}
        className={cn(
          "shrink-0 rounded p-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isMe
            ? "text-primary hover:text-primary/80"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <UserCheck className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* View dashboard */}
      <Link
        href={`/shooter/${result.shooterId}`}
        onClick={onNavigate}
        aria-label={`View ${result.name}'s dashboard`}
        className={cn(
          "shrink-0 rounded p-2 text-muted-foreground transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </Link>
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrackedShootersSheet({
  open,
  onOpenChange,
}: TrackedShootersSheetProps) {
  const { identity, setIdentity, clearIdentity } = useMyIdentity();
  const { tracked, trackedIds, add, remove } = useTrackedShooters();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      setSearchInput("");
      setDebouncedSearch("");
    }
    onOpenChange(isOpen);
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const searchEnabled = debouncedSearch.length >= 2;
  const { data: searchResults = [], isLoading: searchLoading } = useShooterSearchQuery(
    debouncedSearch,
    20,
    searchEnabled,
  );

  function handleToggleTracked(result: ShooterSearchResult) {
    if (trackedIds.has(result.shooterId)) {
      remove(result.shooterId);
    } else {
      add({ shooterId: result.shooterId, name: result.name, club: result.club, division: result.division });
    }
  }

  function handleToggleMe(result: ShooterSearchResult) {
    if (identity?.shooterId === result.shooterId) {
      clearIdentity();
    } else {
      setIdentity({ shooterId: result.shooterId, name: result.name, license: null });
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="pb-2">
          <SheetTitle>My shooters</SheetTitle>
          <SheetDescription>
            Tracked competitors are auto-selected when you visit their matches.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-4 space-y-5">

          {/* ── Find shooter ── */}
          <section aria-labelledby="find-shooter-heading">
            <h3
              id="find-shooter-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              Find shooter
            </h3>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                placeholder="Search by name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Search shooter by name"
                aria-controls="shooter-search-results"
                className={cn(
                  "w-full rounded-lg border bg-background px-3 py-2 pl-9 text-sm",
                  "placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-ring",
                )}
              />
            </div>

            <div id="shooter-search-results" role="region" aria-label="Search results" aria-live="polite">
              {searchLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching…" />
                </div>
              ) : searchEnabled && searchResults.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  No shooters found. They may not have appeared in any cached match.
                </p>
              ) : searchResults.length > 0 ? (
                <ul className="mt-2 space-y-1.5" aria-label="Shooter search results">
                  {searchResults.map((result) => (
                    <SearchResultRow
                      key={result.shooterId}
                      result={result}
                      isTracked={trackedIds.has(result.shooterId)}
                      isMe={identity?.shooterId === result.shooterId}
                      onToggleTracked={() => handleToggleTracked(result)}
                      onToggleMe={() => handleToggleMe(result)}
                      onNavigate={() => onOpenChange(false)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="pt-2 text-xs text-muted-foreground">
                  Type at least 2 characters to search.
                </p>
              )}
            </div>
          </section>

          {/* ── Your identity ── */}
          <section aria-labelledby="identity-heading">
            <h3
              id="identity-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              Your identity
            </h3>
            {identity ? (
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <UserCheck className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{identity.name}</p>
                  {identity.license && (
                    <p className="text-xs text-muted-foreground truncate">
                      {identity.license}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearIdentity}
                  className="shrink-0 p-2 rounded hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  aria-label={`Clear identity: ${identity.name}`}
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not set. Search for your name above and tap{" "}
                <UserCheck className="inline w-3.5 h-3.5" aria-hidden="true" />{" "}
                to claim your identity, or tap the{" "}
                <User className="inline w-3.5 h-3.5" aria-hidden="true" />{" "}
                icon next to your name in the competitor picker.
              </p>
            )}
          </section>

          {/* ── Tracked competitors ── */}
          <section aria-labelledby="tracked-heading">
            <h3
              id="tracked-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              Tracked competitors ({tracked.length})
            </h3>
            {tracked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tracked competitors. Search above or tap the star icon next to a competitor in the picker.
              </p>
            ) : (
              <ul className="space-y-1" aria-label="Tracked competitors">
                {tracked.map((t) => (
                  <li
                    key={t.shooterId}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      {(t.division ?? t.club) && (
                        <p className="text-xs text-muted-foreground truncate">
                          {[t.division, t.club].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <Link
                      href={`/shooter/${t.shooterId}`}
                      onClick={() => onOpenChange(false)}
                      aria-label={`View ${t.name}'s dashboard`}
                      className={cn(
                        "shrink-0 rounded p-2 text-muted-foreground transition-colors",
                        "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(t.shooterId)}
                      className="shrink-0 p-2 rounded hover:bg-destructive/10 hover:text-destructive transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      aria-label={`Remove ${t.name} from tracked`}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(identity || tracked.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearIdentity();
                tracked.forEach((t) => remove(t.shooterId));
              }}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              Clear all
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
