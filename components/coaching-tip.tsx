"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const { data, isFetching, isError, refetch } = useCoachingTipQuery(
    ct,
    id,
    competitorId,
  );

  return (
    <div className="mt-1">
      {!data && !isFetching && !isError && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 h-auto"
          onClick={() => refetch()}
          aria-label={`Get coaching tip for ${competitorName}`}
        >
          <Sparkles className="w-3 h-3" aria-hidden="true" />
          AI tip
        </Button>
      )}

      {isFetching && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground py-0.5">
          <Loader2
            className="w-3 h-3 animate-spin"
            aria-hidden="true"
          />
          Generating…
        </span>
      )}

      {isError && !isFetching && (
        <span className="text-[11px] text-muted-foreground py-0.5">
          Unavailable.{" "}
          <button
            className="underline hover:text-foreground"
            onClick={() => refetch()}
            aria-label={`Retry coaching tip for ${competitorName}`}
          >
            Retry
          </button>
        </span>
      )}

      {data && (
        <div className="text-[11px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 mt-1 max-w-[12rem] leading-relaxed">
          {data.tip}
        </div>
      )}
    </div>
  );
}
