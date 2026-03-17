"use client";

import { useState } from "react";
import { ExternalLink, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface ShareEventLinkProps {
  ct: string;
  id: string;
  matchName?: string;
}

/**
 * Copies the /event/{ct}/{id} proxy link — shows a nice OG preview in
 * social media but redirects visitors to ShootNScoreIt.
 */
export function ShareEventLink({ ct, id, matchName }: ShareEventLinkProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const eventPath = `/event/${ct}/${id}`;

  function getEventUrl() {
    const base =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${base}${eventPath}`;
  }

  function getOgImageUrl() {
    const base =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/api/og/match/${ct}/${id}`;
  }

  async function handleCopy() {
    const url = getEventUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  async function handleShare() {
    const url = getEventUrl();
    if (navigator.share) {
      try {
        await navigator.share({ url, title: matchName });
        return;
      } catch (err) {
        if ((err as { name?: unknown }).name === "AbortError") return;
      }
    }
    await handleCopy();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Share SSI event link"
          title="Share link to SSI with rich preview"
        >
          <ExternalLink className="w-4 h-4" />
          <span className="hidden sm:inline">SSI link</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 p-0 overflow-hidden"
        align="end"
      >
        {/* OG image preview — lazy-loaded since popover starts closed */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getOgImageUrl()}
          alt={`Preview image for ${matchName ?? "this match"}`}
          width={1200}
          height={630}
          loading="lazy"
          className="w-full h-auto"
        />

        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-1">
            <p className="font-medium text-sm">Share link to ShootNScoreIt</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              This link shows a rich preview in Slack, Discord, and social media
              — then takes visitors directly to the match on ShootNScoreIt.
            </p>
          </div>

          <div
            className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground font-mono truncate"
            title={eventPath}
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{eventPath}</span>
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={handleShare}
            aria-live="polite"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied to clipboard
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy link
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
