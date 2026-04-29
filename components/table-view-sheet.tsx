"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sliders } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTableViewPrefs } from "@/hooks/use-table-view-prefs";
import {
  GROUP_DESCRIPTIONS,
  GROUP_LABELS,
  PRESET_DESCRIPTIONS,
  PRESET_LABELS,
  TABLE_VIEW_GROUPS,
  type TableViewGroup,
  type TableViewPreset,
} from "@/lib/table-view-prefs";

const PRESET_ORDER: Array<Exclude<TableViewPreset, "custom">> = [
  "courtside",
  "standard",
  "deep",
];

export function TableViewSheet() {
  const { prefs, setPreset, toggleGroup } = useTableViewPrefs();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label="Customize comparison table view"
        >
          <Sliders className="w-4 h-4" aria-hidden="true" />
          View
          {prefs.preset !== "custom" && (
            <span className="text-xs text-muted-foreground font-normal">
              · {PRESET_LABELS[prefs.preset]}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[min(22rem,calc(100vw-2rem))]"
        align="start"
      >
        <div className="px-3 py-2 border-b">
          <p className="text-xs font-medium text-foreground">Preset</p>
          <p className="text-xs text-muted-foreground">
            Quick layouts. Toggle anything below to make a custom view.
          </p>
        </div>
        <div className="p-2 grid grid-cols-3 gap-1" role="radiogroup" aria-label="Layout preset">
          {PRESET_ORDER.map((p) => {
            const active = prefs.preset === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(p)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors",
                  "border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                <span className="text-xs font-medium">{PRESET_LABELS[p]}</span>
                <span
                  className={cn(
                    "text-[10px] leading-tight line-clamp-2",
                    active ? "text-background/80" : "text-muted-foreground",
                  )}
                >
                  {PRESET_DESCRIPTIONS[p]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-b">
          <p className="text-xs font-medium text-foreground">Show in table</p>
          <p className="text-xs text-muted-foreground">
            Always on: hit factor, points, time, names, totals.
          </p>
        </div>
        <ul className="p-1">
          {TABLE_VIEW_GROUPS.map((group) => (
            <li key={group}>
              <GroupSwitch
                group={group}
                enabled={prefs.groups[group]}
                onToggle={() => toggleGroup(group)}
              />
            </li>
          ))}
        </ul>
        {prefs.preset === "custom" && (
          <div className="px-3 py-2 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Custom view</span>
            <button
              type="button"
              onClick={() => setPreset("standard")}
              className="text-xs underline underline-offset-2 hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
            >
              Reset to Standard
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GroupSwitch({
  group,
  enabled,
  onToggle,
}: {
  group: TableViewGroup;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={enabled}
      className={cn(
        "w-full flex items-start justify-between gap-3 rounded px-3 py-2 text-left",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        "min-h-11",
      )}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{GROUP_LABELS[group]}</span>
        <span className="block text-xs text-muted-foreground">
          {GROUP_DESCRIPTIONS[group]}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "shrink-0 mt-0.5 inline-flex h-5 w-9 items-center rounded-full transition-colors",
          enabled ? "bg-foreground" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
