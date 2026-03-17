"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";
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

  function getEventUrl() {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "";
    return `${base}/event/${ct}/${id}`;
  }

  async function handleCopy() {
    const url = getEventUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    } catch {
      // Fallback: select text in a temporary input
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1500);
    }
  }

  async function handleShare() {
    const url = getEventUrl();
    if (navigator.share) {
      try {
        await navigator.share({ url, title: matchName });
        setOpen(false);
      } catch (err) {
        if ((err as { name?: unknown }).name === "AbortError") return;
        await handleCopy();
      }
    } else {
      await handleCopy();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Share event link with rich preview"
          title="Share event link with rich preview"
        >
          <Link2 className="w-4 h-4" />
          <span className="hidden sm:inline">Event link</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 space-y-3 text-sm"
        align="end"
      >
        <p className="font-medium">Share event link</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Copies a link with a rich preview image for social media.
          Visitors are redirected to ShootNScoreIt.
        </p>
        <Button
          size="sm"
          className="w-full"
          onClick={handleShare}
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              Copied
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4" />
              Copy event link
            </>
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
