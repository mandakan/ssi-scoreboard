"use client";

import Link from "next/link";
import { Coffee, Crosshair, Github } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWhatsNew } from "@/components/whats-new-provider";
import { RELEASES } from "@/lib/releases";

export function Footer() {
  const { setOpen } = useWhatsNew();
  const hasReleases = RELEASES.length > 0;

  return (
    <footer className="w-full flex flex-col items-center gap-2 p-4 text-xs text-muted-foreground border-t border-border mt-auto">
      {/* Buy me a coffee button – visible on sm+ screens */}
      <a
        href="https://www.buymeacoffee.com/thias"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FFDD00] text-black font-medium text-sm hover:opacity-90 transition-opacity"
        aria-label="Buy me a coffee on Buy Me a Coffee (opens in new tab)"
      >
        <Coffee className="w-4 h-4" aria-hidden="true" />
        Buy me a coffee
      </a>
      <div className="flex items-center gap-4 flex-wrap justify-center">
        <ThemeToggle />
        <a
          href="https://shootnscoreit.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center hover:text-foreground transition-colors"
          aria-label="Shoot'n Score It (opens in new tab)"
        >
          <Crosshair className="w-4 h-4" aria-hidden="true" />
        </a>
        <a
          href="https://github.com/mandakan/ssi-scoreboard"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center hover:text-foreground transition-colors"
          aria-label="Source code on GitHub (opens in new tab)"
        >
          <Github className="w-4 h-4" aria-hidden="true" />
        </a>
        {/* Coffee icon link – mobile only (hidden on sm+) */}
        <a
          href="https://www.buymeacoffee.com/thias"
          target="_blank"
          rel="noopener noreferrer"
          className="sm:hidden inline-flex items-center hover:text-foreground transition-colors"
          aria-label="Buy me a coffee on Buy Me a Coffee (opens in new tab)"
        >
          <Coffee className="w-4 h-4" aria-hidden="true" />
        </a>
        <Link
          href="/about#install"
          className="inline-flex items-center hover:text-foreground transition-colors"
        >
          Install app
        </Link>
        <Link
          href="/about"
          className="inline-flex items-center hover:text-foreground transition-colors"
        >
          About
        </Link>
        {hasReleases && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center hover:text-foreground transition-colors cursor-pointer"
          >
            What&apos;s new
          </button>
        )}
        <Link
          href="/legal"
          className="inline-flex items-center hover:text-foreground transition-colors"
        >
          Terms &amp; Privacy
        </Link>
      </div>
      <p className="text-center max-w-sm">
        Match data is fetched from Shoot&apos;n Score It and displayed via this
        app. SSI is not responsible for the privacy, security, or integrity of
        data shown here.
      </p>
      {process.env.NEXT_PUBLIC_BUILD_ID && (
        <p className="text-[11px] text-muted-foreground/50">
          {process.env.NEXT_PUBLIC_BUILD_DATE && (
            <span>{process.env.NEXT_PUBLIC_BUILD_DATE} · </span>
          )}
          <a
            href={`https://github.com/mandakan/ssi-scoreboard/commit/${process.env.NEXT_PUBLIC_BUILD_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-muted-foreground transition-colors"
            aria-label={`View source at commit ${process.env.NEXT_PUBLIC_BUILD_ID} on GitHub (opens in new tab)`}
          >
            {process.env.NEXT_PUBLIC_BUILD_ID}
          </a>
        </p>
      )}
    </footer>
  );
}
