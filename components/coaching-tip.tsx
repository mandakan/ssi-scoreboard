"use client";

import { useState } from "react";
import { Flame, GraduationCap, Loader2, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCoachingTipQuery } from "@/lib/queries";
import { useAIConsent } from "@/hooks/use-ai-consent";
import { AIConsentDialog } from "@/components/ai-consent-dialog";

type Mode = "coach" | "roast";

interface CoachingTipProps {
  ct: string;
  id: string;
  competitorId: number;
  competitorName: string;
}

interface TipPanelProps {
  ct: string;
  id: string;
  competitorId: number;
  competitorName: string;
  mode: Mode;
  /** Called when the popover first opens — triggers initial fetch */
  autoFetch: boolean;
}

function TipPanel({ ct, id, competitorId, competitorName, mode, autoFetch }: TipPanelProps) {
  const { data, isFetching, isError, refetch } = useCoachingTipQuery(
    ct,
    id,
    competitorId,
    mode,
  );

  // Trigger on first render when autoFetch is true and no data exists
  if (autoFetch && !data && !isFetching && !isError) {
    void refetch();
  }

  if (isFetching) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        {mode === "roast" ? "Preparing roast…" : "Generating…"}
      </span>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not generate.{" "}
        <button
          className="underline hover:text-foreground"
          onClick={() => void refetch()}
          aria-label={`Retry ${mode} for ${competitorName}`}
        >
          Retry
        </button>
      </p>
    );
  }

  if (data?.available === false) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Available after match completes
      </p>
    );
  }

  if (data?.tip) {
    return <p className="text-sm leading-relaxed">{data.tip}</p>;
  }

  return (
    <button
      className="text-sm text-muted-foreground underline hover:text-foreground"
      onClick={() => void refetch()}
      aria-label={`Generate ${mode === "roast" ? "roast" : "coaching tip"} for ${competitorName}`}
    >
      Generate
    </button>
  );
}

export function CoachingTip({
  ct,
  id,
  competitorId,
  competitorName,
}: CoachingTipProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("coach");
  // Track which modes have been opened so TipPanel knows when to auto-fetch
  const [activated, setActivated] = useState<Set<Mode>>(new Set());
  const { consent } = useAIConsent();
  const [showConsent, setShowConsent] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next && consent !== "granted") {
      setShowConsent(true);
      return;
    }
    setOpen(next);
    if (next) {
      setActivated((prev) => new Set(prev).add(mode));
    }
  }

  function handleConsented() {
    setOpen(true);
    setActivated((prev) => new Set(prev).add(mode));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setActivated((prev) => new Set(prev).add(next));
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`AI coaching for ${competitorName}`}
          >
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            Ask AI
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side="bottom"
          className="w-72 max-w-[calc(100vw-2rem)] p-3"
        >
          <PopoverHeader className="mb-2">
            <PopoverTitle className="flex items-center gap-1.5 text-sm">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
              AI Analysis
            </PopoverTitle>
            <PopoverDescription className="text-xs">{competitorName}</PopoverDescription>
          </PopoverHeader>

          {/* Mode toggle */}
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => { if (v) switchMode(v as "coach" | "roast"); }}
            className="w-auto flex gap-1 mb-3 rounded-md border p-0.5"
            aria-label="Analysis mode"
          >
            <ToggleGroupItem
              value="coach"
              className={cn(
                "h-auto min-w-0 flex flex-1 items-center justify-center gap-1.5 rounded py-1 px-2 text-xs font-medium transition-colors",
                mode === "coach"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GraduationCap className="w-3 h-3" aria-hidden="true" />
              Coach
            </ToggleGroupItem>
            <ToggleGroupItem
              value="roast"
              className={cn(
                "h-auto min-w-0 flex flex-1 items-center justify-center gap-1.5 rounded py-1 px-2 text-xs font-medium transition-colors",
                mode === "roast"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Flame className="w-3 h-3" aria-hidden="true" />
              Roast
            </ToggleGroupItem>
          </ToggleGroup>

          <TipPanel
            key={mode}
            ct={ct}
            id={id}
            competitorId={competitorId}
            competitorName={competitorName}
            mode={mode}
            autoFetch={activated.has(mode)}
          />
        </PopoverContent>
      </Popover>

      <AIConsentDialog
        open={showConsent}
        onOpenChange={setShowConsent}
        onConsented={handleConsented}
      />
    </>
  );
}
