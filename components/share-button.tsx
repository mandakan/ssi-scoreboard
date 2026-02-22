"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ShareButtonProps {
  title?: string;
}

export function ShareButton({ title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ url, title });
      } catch (err) {
        if ((err as { name?: unknown }).name === "AbortError") return;
        await copyToClipboard(url);
      }
    } else {
      await copyToClipboard(url);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleShare}
      aria-label={copied ? "Link copied" : "Share comparison link"}
    >
      {copied ? (
        <Check className="w-4 h-4" />
      ) : (
        <Share2 className="w-4 h-4" />
      )}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
