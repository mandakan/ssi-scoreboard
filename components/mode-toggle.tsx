"use client";

import { useCallback, useRef } from "react";
import type { CompareMode } from "@/lib/types";

interface ModeToggleProps {
  /** The mode the system would choose automatically. */
  autoMode: CompareMode;
  /** The mode currently in effect (override ?? autoMode). */
  effectiveMode: CompareMode;
  /** Called with a mode to set an override, or null to clear the override. */
  onModeChange: (mode: CompareMode | null) => void;
}

const OPTIONS: { value: CompareMode; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "coaching", label: "Coaching" },
];

export function ModeToggle({ autoMode, effectiveMode, onModeChange }: ModeToggleProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (value: CompareMode) => {
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
      const currentIdx = OPTIONS.findIndex((o) => o.value === (e.currentTarget.dataset.value as CompareMode));
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + OPTIONS.length) % OPTIONS.length;
      }
      if (nextIdx >= 0) {
        const next = OPTIONS[nextIdx];
        handleClick(next.value);
        const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons?.[nextIdx]?.focus();
      }
    },
    [handleClick],
  );

  // Whether the user has an active override (effectiveMode !== autoMode)
  const hasOverride = effectiveMode !== autoMode;

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Compare mode"
      className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5"
    >
      {OPTIONS.map((opt, i) => {
        const isActive = opt.value === effectiveMode;
        const showAuto = opt.value === autoMode && !hasOverride;
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
              "relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "min-h-[2.75rem] min-w-[5.5rem]",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-transparent text-muted-foreground hover:text-foreground",
              i === 0 ? "rounded-r-md" : "rounded-l-md",
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
