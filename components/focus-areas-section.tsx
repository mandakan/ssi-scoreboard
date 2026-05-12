"use client";

import {
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  ShieldAlert,
  Swords,
  Hand,
  Clock,
  Eye,
  Brain,
  Activity,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FocusArea, FocusAreaCategory, FocusAreaConfidence } from "@/lib/types";

interface FocusAreasSectionProps {
  focusAreas: FocusArea[];
  competitorName: string;
}

const CATEGORY_ICON: Record<FocusAreaCategory, React.ComponentType<{ className?: string; "aria-hidden"?: "true" }>> = {
  safety: ShieldAlert,
  "mistake-reduction": AlertTriangle,
  "weak-hand": Hand,
  "long-stages": Activity,
  tempo: Clock,
  "sight-discipline": Eye,
  "match-nerves": Brain,
  stamina: Swords,
};

const CONFIDENCE_LABEL: Record<FocusAreaConfidence, string> = {
  low: "low confidence",
  medium: "medium confidence",
  high: "high confidence",
};

const CONFIDENCE_DOT_CLASS: Record<FocusAreaConfidence, string> = {
  low: "bg-muted-foreground/40",
  medium: "bg-amber-500",
  high: "bg-green-500",
};

const CATEGORY_STATIC_TIP: Record<FocusAreaCategory, string> = {
  safety: "Dry-fire the sequence until it is automatic. Film yourself to verify you are not skipping the end-of-stage procedure.",
  "mistake-reduction": "Slow your transitions by 10% on stages with tight no-shoot arrangements. Track penalty type per stage to find patterns.",
  "weak-hand": "Add 5 min of weak-hand dry-fire to every session. Focus on grip consistency, not speed.",
  "long-stages": "Pace yourself on longer courses -- build a mental checkpoint every 4-5 targets to confirm you are on track.",
  tempo: "Practice par-time drills. Set the timer 5-10% faster than your comfort zone and accept the occasional miss in training.",
  "sight-discipline": "Call every shot. After each run, state aloud which hits you would change. If you cannot call them, slow your trigger.",
  "match-nerves": "Build a consistent pre-stage routine (breathe, visualise, cue word). Use the same routine in club matches to anchor it.",
  stamina: "Simulate match fatigue in training: shoot your hardest stages last. Track hydration and sleep the night before.",
};

function FocusAreaCard({ area }: { area: FocusArea }) {
  const Icon = CATEGORY_ICON[area.category];
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start gap-2.5">
        <Icon
          className={cn(
            "mt-0.5 w-4 h-4 shrink-0",
            area.category === "safety" ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-medium text-sm leading-none">{area.title}</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className={cn("w-2 h-2 rounded-full shrink-0", CONFIDENCE_DOT_CLASS[area.confidence])}
                aria-hidden="true"
              />
              {CONFIDENCE_LABEL[area.confidence]}
            </span>
            {area.estimatedRecoverableMatchPct != null && (
              <span className="ml-auto text-xs font-mono text-muted-foreground">
                ~{area.estimatedRecoverableMatchPct.toFixed(1)}% recoverable
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{area.evidence}</p>
          <p className="text-xs text-muted-foreground/70 leading-relaxed mt-1 italic">
            {CATEGORY_STATIC_TIP[area.category]}
          </p>
        </div>
      </div>
      <a
        href={`#${area.chartAnchor}`}
        className="inline-flex items-center gap-1 self-end text-xs text-primary underline underline-offset-2 hover:opacity-80 min-h-[44px] py-2 px-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
        aria-label={`Jump to chart for ${area.title}`}
      >
        Jump to chart
        <ArrowRight className="w-3 h-3" aria-hidden="true" />
      </a>
    </div>
  );
}

export function FocusAreasSection({ focusAreas, competitorName }: FocusAreasSectionProps) {
  if (focusAreas.length === 0) return null;

  return (
    <section
      id="focus-areas"
      aria-labelledby="focus-areas-heading"
      className="rounded-lg border p-4 space-y-3"
    >
      <div className="flex items-center gap-1.5">
        <h2 id="focus-areas-heading" className="font-semibold">
          Focus areas
        </h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About focus areas"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Focus areas</PopoverTitle>
              <PopoverDescription>
                A ranked synthesis of the analytics below -- the highest-leverage things to work on based on {competitorName}&apos;s results.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>Rules fire only when the underlying data crosses a meaningful threshold and there are enough stages to be confident. Confidence dots: green = high (6+ stages), amber = medium (3-5 stages), grey = low.</p>
              <p>The recoverable % is a rough ranking estimate, not a guarantee. It shows which focus area has the most upside, not the exact % you will gain.</p>
              <p>At most 3 areas are shown. Safety issues always appear first when present. Use the &ldquo;jump to chart&rdquo; link on each card to scroll to the supporting data.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ol className="space-y-2 list-none">
        {focusAreas.map((area) => (
          <li key={area.category}>
            <FocusAreaCard area={area} />
          </li>
        ))}
      </ol>
    </section>
  );
}
