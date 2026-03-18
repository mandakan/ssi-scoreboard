"use client";

import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareDrawer } from "@/components/share-drawer";

interface ShareButtonProps {
  title?: string;
  competitorCount?: number;
}

export function ShareButton({ title, competitorCount = 0 }: ShareButtonProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const currentPath =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "";

  // OG image URL: include competitors param if any are selected
  const ogPath =
    typeof window !== "undefined"
      ? window.location.pathname.replace(/^\/match\//, "/api/og/match/")
      : "";
  const competitorsParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("competitors")
      : null;
  const ogImageUrl = competitorsParam
    ? `${origin}${ogPath}?competitors=${competitorsParam}`
    : `${origin}${ogPath}`;

  const competitorSuffix =
    competitorCount > 0
      ? ` with ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
      : "";

  const description =
    competitorCount > 0
      ? `Share this comparison of ${competitorCount} competitor${competitorCount === 1 ? "" : "s"} — the link includes a rich preview image for social media.`
      : "Share this match page — the link includes a rich preview image for social media.";

  return (
    <ShareDrawer
      title={`Share${competitorSuffix}`}
      description={description}
      sharePath={currentPath}
      ogImageUrl={ogImageUrl}
      ogImageAlt={`Preview of ${title ?? "this match"} on SSI Scoreboard`}
      shareTitle={title}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            competitorCount > 0
              ? `Share comparison link with ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
              : "Share match link"
          }
          title={
            competitorCount > 0
              ? `Share comparison link with ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
              : "Share match link"
          }
        >
          <span className="relative inline-flex">
            <Share2 className="w-4 h-4" />
            {competitorCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold leading-none text-primary-foreground tabular-nums"
              >
                {competitorCount}
              </span>
            )}
          </span>
          Share
        </Button>
      }
    />
  );
}
