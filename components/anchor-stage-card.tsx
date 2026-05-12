"use client";

import { HelpCircle, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import type { AnchorStage } from "@/lib/types";

interface AnchorStageCardProps {
  anchorStage: AnchorStage;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short" });
}

export function AnchorStageCard({ anchorStage }: AnchorStageCardProps) {
  const matchPath = `/match/${anchorStage.ct}/${anchorStage.matchId}#stage-${anchorStage.stageNumber}`;
  const stagePctDisplay = anchorStage.stagePct.toFixed(1);
  const dateStr = formatDate(anchorStage.date);
  const metaParts = [
    anchorStage.division,
    dateStr,
  ].filter(Boolean);

  return (
    <section aria-labelledby="anchor-stage-heading">
      <div className="flex items-center gap-1 mb-2">
        <h2
          id="anchor-stage-heading"
          className="text-sm font-semibold text-muted-foreground uppercase tracking-wide"
        >
          Your peak stage
        </h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About your peak stage"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Your peak stage</PopoverTitle>
              <PopoverDescription>
                The single best stage in your match history -- highest hit factor as a percentage of the division stage winner.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>The percentage shown is your hit factor divided by the division stage winner&apos;s hit factor. 100% means you won the stage outright.</p>
              <p>Shown when you have at least 10 valid stages on record. Use it as a confidence cue before your next match -- this is your ceiling.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <a
        href={matchPath}
        className="group block rounded-lg border bg-muted/30 p-4 hover:bg-muted/50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Your best stage: ${stagePctDisplay}% of stage winner on Stage ${anchorStage.stageNumber}, ${anchorStage.stageName}, at ${anchorStage.matchName}. Open match page.`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-3xl font-bold tabular-nums leading-none mb-1"
              aria-hidden="true"
            >
              {stagePctDisplay}%
            </div>
            <div className="text-xs text-muted-foreground mb-0.5">
              of stage winner
            </div>
            <div className="font-medium text-sm truncate">
              Stage {anchorStage.stageNumber}: {anchorStage.stageName}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {anchorStage.matchName}
            </div>
            {metaParts.length > 0 && (
              <div className="text-xs text-muted-foreground/70 mt-0.5">
                {metaParts.join(" · ")}
              </div>
            )}
          </div>
          <ExternalLink
            className="w-4 h-4 text-muted-foreground shrink-0 mt-1 group-hover:text-foreground transition-colors"
            aria-hidden="true"
          />
        </div>
      </a>
    </section>
  );
}
