"use client";

import { useState, type ReactNode } from "react";
import { Share2, Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

interface ShareDrawerProps {
  /** Title shown in the drawer header */
  title: string;
  /** Description shown below the title */
  description: string;
  /** The URL path to share (e.g. /match/22/123?competitors=1,2) */
  sharePath: string;
  /** OG image URL for the preview thumbnail */
  ogImageUrl: string;
  /** Alt text for the preview image */
  ogImageAlt: string;
  /** Name used for navigator.share() title */
  shareTitle?: string;
  /** Custom trigger button — defaults to a Share ghost button */
  trigger?: ReactNode;
}

/**
 * Reusable share drawer with OG image preview.
 * Bottom-sheet (Vaul Drawer) — swipe-dismissible, thumb-friendly on mobile.
 */
export function ShareDrawer({
  title,
  description,
  sharePath,
  ogImageUrl,
  ogImageAlt,
  shareTitle,
  trigger,
}: ShareDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  function getFullUrl() {
    const base =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${base}${sharePath}`;
  }

  async function handleCopy() {
    const url = getFullUrl();
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
    const url = getFullUrl();
    if (navigator.share) {
      try {
        await navigator.share({ url, title: shareTitle });
        return;
      } catch (err) {
        if ((err as { name?: unknown }).name === "AbortError") return;
      }
    }
    await handleCopy();
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Share: ${shareTitle ?? title}`}
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">Share</span>
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent className="max-h-[90vh]">
        <div className="mx-auto flex w-full max-w-lg flex-col min-h-0 flex-1">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 space-y-4 overflow-y-auto min-h-0 flex-1">
            {/* OG image preview — lazy-loaded */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ogImageUrl}
              alt={ogImageAlt}
              width={1200}
              height={630}
              loading="lazy"
              className="w-full h-auto rounded-lg border"
            />

            {/* URL preview */}
            <div
              className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground font-mono truncate"
              title={sharePath}
            >
              <Link2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{sharePath}</span>
            </div>
          </div>

          <DrawerFooter>
          <Button
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
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              Cancel
            </Button>
          </DrawerClose>
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
