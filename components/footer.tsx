"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart2, Coffee, Crosshair, Github, Smartphone, UserCheck, Users } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWhatsNew } from "@/components/whats-new-provider";
import { RELEASES } from "@/lib/releases";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";

export function Footer() {
  const { setOpen } = useWhatsNew();
  const hasReleases = RELEASES.length > 0;
  const { identity } = useMyIdentity();
  const [showManage, setShowManage] = useState(false);

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

      {/* Desktop-only nav items — the bottom nav handles these on mobile */}
      <div className="hidden md:flex items-center gap-4 flex-wrap justify-center">
        <ThemeToggle />
        {identity && (
          <Link
            href={`/shooter/${identity.shooterId}`}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label="My stats — view your personal match history"
          >
            <BarChart2 className="w-4 h-4" aria-hidden="true" />
            <span>My Stats</span>
          </Link>
        )}
        <button
          type="button"
          onClick={() => setShowManage(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          aria-label={identity ? `Your identity: ${identity.name}. Click to manage.` : "My shooters — track competitors and manage your identity"}
        >
          {identity ? (
            <>
              <UserCheck className="w-4 h-4" aria-hidden="true" />
              <span>{identity.name}</span>
            </>
          ) : (
            <>
              <Users className="w-4 h-4" aria-hidden="true" />
              <span>My shooters</span>
            </>
          )}
        </button>
        <Link
          href="/sync"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          aria-label="Sync settings between devices"
        >
          <Smartphone className="w-4 h-4" aria-hidden="true" />
          <span>Sync</span>
        </Link>
        <Link
          href="/about#install"
          className="inline-flex items-center hover:text-foreground transition-colors"
        >
          Install app
        </Link>
      </div>

      <div className="flex items-center gap-4 flex-wrap justify-center">
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

      <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
    </footer>
  );
}
