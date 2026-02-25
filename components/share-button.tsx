"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareButtonProps {
  title?: string;
  competitorCount?: number;
}

export function ShareButton({ title, competitorCount = 0 }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const competitorSuffix =
    competitorCount > 0
      ? ` · ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
      : "";

  async function copyToClipboard(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    const url = window.location.href;
    const text =
      competitorCount > 0
        ? `${competitorCount} competitor${competitorCount === 1 ? "" : "s"} selected`
        : undefined;

    if (navigator.share) {
      try {
        const shareData: ShareData = { url, title };
        if (text) shareData.text = text;
        await navigator.share(shareData);
      } catch (err) {
        if ((err as { name?: unknown }).name === "AbortError") return;
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  }

  const idleLabel =
    competitorCount > 0
      ? `Share comparison link with ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
      : "Share match link";
  const copiedLabel =
    competitorCount > 0
      ? `Link copied with ${competitorCount} competitor${competitorCount === 1 ? "" : "s"}`
      : "Link copied";

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleShare}
      aria-label={copied ? copiedLabel : idleLabel}
      title={idleLabel}
    >
      {copied ? (
        <Check className="w-4 h-4" />
      ) : (
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
      )}
      {copied ? `Copied${competitorSuffix}` : "Share"}
    </Button>
  );
}
