"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MatchGate, useMatch } from "@/components/match-gate";
import { MatchTabBar } from "@/components/match-tab-bar";
import { saveRecentCompetition } from "@/lib/competition-store";

function TopBar() {
  const { ct, id, match } = useMatch();
  useEffect(() => saveRecentCompetition(ct, id, match), [ct, id, match]);
  return (
    <header className="sticky top-0 md:top-14 z-30 flex h-12 items-center gap-2 border-b bg-card px-2">
      <Link href="/" aria-label="All matches" className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      {/* A <p>, not a heading: the Info tab's MatchHeader already renders the match name as a heading. */}
      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{match.name}</p>
      <span className="shrink-0 pr-2 font-mono text-xs text-muted-foreground" aria-label={`${Math.round(match.scoring_pct)} percent scored`}>
        {Math.round(match.scoring_pct)}%
      </span>
    </header>
  );
}

/**
 * Chrome for every match tab: top bar, bottom tab bar, and the MatchGate that
 * owns loading and error states. Lives in the layout, so it persists across
 * tab switches -- the match query and its polling survive navigation.
 */
export function MatchShell({ ct, id, children }: { ct: string; id: string; children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-[100dvh] flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <MatchGate ct={ct} id={id}>
        <TopBar />
        <div className="min-h-0 flex-1">{children}</div>
      </MatchGate>
      <MatchTabBar ct={ct} id={id} />
    </main>
  );
}
