"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Info, LayoutGrid } from "lucide-react";
import { MATCH_TABS, matchTabFromPath, matchTabHref, type MatchTab } from "@/lib/match-routes";
import { trackUi } from "@/lib/ui-telemetry";
import { cn } from "@/lib/utils";

const LABEL: Record<MatchTab, string> = { grid: "Grid", info: "Info", analysis: "Analysis" };
const ICON: Record<MatchTab, typeof Info> = { grid: LayoutGrid, info: Info, analysis: BarChart3 };

/** Bottom tab bar inside a match. Real routes, so links -- not a tablist. */
export function MatchTabBar({ ct, id }: { ct: string; id: string }) {
  const active = matchTabFromPath(usePathname());

  useEffect(() => {
    trackUi({ op: "tab-view", ct: parseInt(ct, 10), tab: active });
  }, [ct, active]);

  return (
    <nav
      aria-label="Match sections"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/90 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-stretch justify-around">
        {MATCH_TABS.map((tab) => {
          const Icon = ICON[tab];
          const current = tab === active;
          return (
            // prefetch={false}: Next's default prefetch of a dynamic route
            // renders down to [id]/loading.tsx, which runs the match layout
            // (fetchMatchData + generateMetadata) for every sibling tab on
            // every page view. That would add upstream calls.
            <Link
              key={tab}
              href={matchTabHref(ct, id, tab)}
              prefetch={false}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-w-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {LABEL[tab]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
