"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { useCoachingTipQuery } from "@/lib/queries";

interface CoachingTipProps {
  ct: string;
  id: string;
  competitorId: number;
  competitorName: string;
}

export function CoachingTip({
  ct,
  id,
  competitorId,
  competitorName,
}: CoachingTipProps) {
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError, refetch } = useCoachingTipQuery(
    ct,
    id,
    competitorId,
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !data && !isFetching) {
      void refetch();
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors mt-1"
          aria-label={`AI coaching tip for ${competitorName}`}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
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
            AI Coaching Tip
          </PopoverTitle>
          <PopoverDescription className="text-xs">{competitorName}</PopoverDescription>
        </PopoverHeader>

        {isFetching && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Generating…
          </span>
        )}

        {isError && !isFetching && (
          <p className="text-sm text-muted-foreground">
            Could not generate tip.{" "}
            <button
              className="underline hover:text-foreground"
              onClick={() => void refetch()}
              aria-label={`Retry coaching tip for ${competitorName}`}
            >
              Retry
            </button>
          </p>
        )}

        {data && (
          <p className="text-sm leading-relaxed">{data.tip}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
