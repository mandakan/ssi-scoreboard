"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { StageInfo } from "@/lib/types";

interface StageListProps {
  stages: StageInfo[];
}

export function StageList({ stages }: StageListProps) {
  const [open, setOpen] = useState(false);

  if (stages.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full flex items-center justify-between px-4 py-3 text-sm font-medium",
            "hover:bg-muted/30 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            open ? "rounded-t-lg" : "rounded-lg"
          )}
        >
          <span>Stages ({stages.length})</span>
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ul
          role="list"
          className="px-2 pb-2 space-y-0.5"
        >
          {stages.map((stage) => (
            <li
              key={stage.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/20"
            >
              {/* Stage number badge */}
              <span
                className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded bg-muted text-xs font-semibold tabular-nums"
                aria-label={`Stage ${stage.stage_number}`}
              >
                {stage.stage_number}
              </span>

              {/* Stage name + detail row */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {stage.name}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                    {stage.max_points} pts
                  </span>
                </div>
                {/* Target/rounds metadata */}
                {(stage.min_rounds != null ||
                  stage.paper_targets != null ||
                  (stage.steel_targets != null && stage.steel_targets > 0)) && (
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {stage.min_rounds != null && (
                      <span>{stage.min_rounds} rds</span>
                    )}
                    {stage.paper_targets != null && (
                      <span>{stage.paper_targets} paper</span>
                    )}
                    {stage.steel_targets != null && stage.steel_targets > 0 && (
                      <span>{stage.steel_targets} steel</span>
                    )}
                  </div>
                )}
              </div>

              {/* SSI external link */}
              {stage.ssi_url ? (
                <a
                  href={stage.ssi_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${stage.name} on ShootNScoreIt (opens in new tab)`}
                  className="flex-shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              ) : (
                /* Placeholder to maintain consistent row height */
                <span className="flex-shrink-0 w-[44px]" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
