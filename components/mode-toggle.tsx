"use client";

import { useCallback, useMemo, useRef } from "react";
import type { MatchView } from "@/lib/types";

interface ModeToggleProps {
  /** The view the system would choose automatically. */
  autoMode: MatchView;
  /** The view currently in effect (override ?? auto). */
  effectiveMode: MatchView;
  /** Whether the pre-match option is offered (hidden once the match is wrapped up). */
  preMatchEligible: boolean;
  /** Called with a view to set an override, or null to clear the override. */
  onModeChange: (mode: MatchView | null) => void;
}

const ALL_OPTIONS: { value: MatchView; label: string }[] = [
  { value: "prematch", label: "Pre-match" },
  { value: "live", label: "Live" },
  { value: "coaching", label: "Coaching" },
];

export function ModeToggle({ autoMode, effectiveMode, preMatchEligible, onModeChange }: ModeToggleProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  // Always include the pre-match option if it's eligible OR currently active
  // (so users mid-override can still see/clear it). Otherwise hide it.
  const options = useMemo(
    () =>
      ALL_OPTIONS.filter(
        (o) =>
          o.value !== "prematch" || preMatchEligible || effectiveMode === "prematch",
      ),
    [preMatchEligible, effectiveMode],
  );

  const handleClick = useCallback(
    (value: MatchView) => {
      if (value === effectiveMode && value === autoMode) {
        // Already on auto — no-op
        return;
      }
      if (value === effectiveMode) {
        // Tapping the active button when override is set → clear override
        onModeChange(null);
      } else {
        onModeChange(value);
      }
    },
    [effectiveMode, autoMode, onModeChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      let nextIdx = -1;
      const currentIdx = options.findIndex((o) => o.value === (e.currentTarget.dataset.value as MatchView));
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % options.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + options.length) % options.length;
      }
      if (nextIdx >= 0) {
        const next = options[nextIdx];
        handleClick(next.value);
        const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons?.[nextIdx]?.focus();
      }
    },
    [handleClick, options],
  );

  // Whether the user has an active override (effectiveMode !== autoMode)
  const hasOverride = effectiveMode !== autoMode;

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Match view"
      className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5"
    >
      {options.map((opt, i) => {
        const isActive = opt.value === effectiveMode;
        const showAuto = opt.value === autoMode && !hasOverride;
        const isFirst = i === 0;
        const isLast = i === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-value={opt.value}
            tabIndex={isActive ? 0 : -1}
            onClick={() => handleClick(opt.value)}
            onKeyDown={handleKeyDown}
            className={[
              "relative px-3 py-1.5 text-sm font-medium transition-colors",
              "min-h-[2.75rem] min-w-[5.5rem]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground",
              isFirst ? "rounded-l-md" : "",
              isLast ? "rounded-r-md" : "",
              !isFirst && !isLast ? "rounded-none" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt.label}
            {showAuto && (
              <span className={isActive ? "text-primary-foreground/70" : "text-muted-foreground/70"}> (auto)</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
