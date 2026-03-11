"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart2, Download, Smartphone, UserCheck, Users } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";

export function SiteHeader() {
  const { identity } = useMyIdentity();
  const [showManage, setShowManage] = useState(false);

  return (
    <>
      <header className="hidden md:flex sticky top-0 z-40 w-full items-center justify-between gap-4 px-6 h-14 border-b border-border bg-background/80 backdrop-blur-lg">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground transition-colors"
          aria-label="SSI Scoreboard — home"
        >
          <AppLogo size={24} />
          SSI Scoreboard
        </Link>

        <nav aria-label="Site navigation" className="flex items-center gap-4 text-xs text-muted-foreground">
          {identity && (
            <Link
              href={`/shooter/${identity.shooterId}`}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
              aria-label="My stats — view your personal match history"
            >
              <BarChart2 className="w-4 h-4" aria-hidden="true" />
              <span>My Stats</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setShowManage(true)}
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
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
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
            aria-label="Sync settings between devices"
          >
            <Smartphone className="w-4 h-4" aria-hidden="true" />
            <span>Sync</span>
          </Link>
          <Link
            href="/about#install"
            className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Install app</span>
          </Link>
          <ThemeToggle />
        </nav>
      </header>

      <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
    </>
  );
}
