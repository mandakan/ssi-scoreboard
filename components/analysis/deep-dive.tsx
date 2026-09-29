"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertCircle, ChevronDown, ChevronUp, HelpCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StageTimesExport } from "@/components/stage-times-export";
import { useCompareQuery } from "@/lib/queries";
import { useHashAnchor } from "@/lib/hooks/use-hash-anchor";
import { trackUi } from "@/lib/ui-telemetry";
import type { CompareMode, CompareResponse, MatchResponse } from "@/lib/types";

// Module-level so the query key stays referentially stable while closed.
const EMPTY_IDS: number[] = [];

const FINGERPRINT_ANCHOR = "chart-style-fingerprint";
// "coaching-analysis" is the id the coaching section had before it became Deep
// dive; coaching-rules focus areas still link to it, so it scrolls to the section.
const DEEP_DIVE_ANCHOR = "coaching-analysis";
const ANCHORS = [FINGERPRINT_ANCHOR, DEEP_DIVE_ANCHOR];

const ChartSkeleton = () => <Skeleton className="h-64 w-full rounded-lg" />;

const StyleFingerprintChart = dynamic(
  () => import("@/components/style-fingerprint-chart").then((m) => m.StyleFingerprintChart),
  { ssr: false, loading: ChartSkeleton },
);
const ArchetypePerformanceSummary = dynamic(
  () => import("@/components/archetype-performance").then((m) => m.ArchetypePerformanceSummary),
  { ssr: false },
);
const CourseLengthSummary = dynamic(
  () => import("@/components/course-performance").then((m) => m.CourseLengthSummary),
  { ssr: false },
);
const ConstraintSummary = dynamic(
  () => import("@/components/course-performance").then((m) => m.ConstraintSummary),
  { ssr: false },
);
const ShooterStyleRadarChart = dynamic(
  () => import("@/components/shooter-style-radar-chart").then((m) => m.ShooterStyleRadarChart),
  { ssr: false, loading: ChartSkeleton },
);
const StageDegradationChart = dynamic(
  () => import("@/components/stage-degradation-chart").then((m) => m.StageDegradationChart),
  { ssr: false, loading: ChartSkeleton },
);
const StageSimulator = dynamic(
  () => import("@/components/stage-simulator").then((m) => m.StageSimulator),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full rounded-lg" /> },
);

interface DeepDiveProps {
  ct: string;
  id: string;
  match: MatchResponse;
  selectedIds: number[];
  compareMode: CompareMode;
  /** The page's compare data when compareMode is "coaching", else undefined. */
  coachingData: CompareResponse | undefined;
  /** Controlled by the page so the state survives this section unmounting. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeepDive({ ct, id, match, selectedIds, compareMode, coachingData, open, onOpenChange: setOpen }: DeepDiveProps) {
  const [showSimulator, setShowSimulator] = useState(false);

  // Live matches: fetch coaching data once, only after the user opens the
  // section. mode "coaching" never polls (lib/queries.ts), and the compare
  // route's upstream path is identical in both modes, so this adds no SSI
  // traffic beyond the live poll already running on this tab. When the page
  // is already in coaching mode we reuse its data and pass no ids (disabled).
  const oneShot = useCompareQuery(
    ct,
    id,
    compareMode === "live" && open ? selectedIds : EMPTY_IDS,
    "coaching",
  );
  const data = compareMode === "coaching" ? coachingData : oneShot.data;

  // Section-open telemetry counts only the closed->open transition.
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "deep-dive" });
      }
    },
    [ct],
  );
  const onSimulatorOpenChange = useCallback(
    (next: boolean) => {
      setShowSimulator(next);
      if (next) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "simulator" });
      }
    },
    [ct],
  );

  // Anchor links (focus-area "Jump to chart") open the section, then scroll to
  // the fingerprint block. The block only exists once the content has rendered
  // (after opening, and after live data arrives), so the scroll is deferred:
  // a pending flag is flushed from a requestAnimationFrame and again from an
  // effect whenever open/data changes, and cleared once the target is found.
  const pendingScroll = useRef<string | null>(null);
  const flushScroll = useCallback(() => {
    const target = pendingScroll.current;
    if (!target) return;
    const el = document.getElementById(target);
    if (!el) return;
    pendingScroll.current = null;
    el.scrollIntoView({ block: "start" });
  }, []);
  const hasData = data != null;
  useEffect(() => {
    if (!open || !hasData) return;
    const raf = requestAnimationFrame(flushScroll);
    return () => cancelAnimationFrame(raf);
  }, [open, hasData, flushScroll]);
  useHashAnchor(ANCHORS, (anchor) => {
    pendingScroll.current = anchor === DEEP_DIVE_ANCHOR ? "deep-dive" : FINGERPRINT_ANCHOR;
    if (!open) onOpenChange(true);
    requestAnimationFrame(flushScroll);
  });

  return (
    <>
      <Collapsible id="deep-dive" open={open} onOpenChange={onOpenChange} className="rounded-lg border p-4 space-y-3">
        {/* WAI-ARIA accordion pattern: heading wraps the disclosure button */}
        <h2 className="font-semibold text-base m-0 leading-none">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              id="deep-dive-heading"
              className="flex w-full items-center justify-between text-left gap-2"
            >
              <span>
                Deep dive
                <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                  Course length, constraints, archetypes, style and stage-order effects, plus stage-time export.
                </span>
              </span>
              {open ? (
                <ChevronUp className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
              )}
            </button>
          </CollapsibleTrigger>
        </h2>

        <CollapsibleContent>
          <section role="region" aria-labelledby="deep-dive-heading" className="space-y-6 pt-2">
            {!data && oneShot.isError ? (
              <div role="alert" className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="w-4 h-4" aria-hidden="true" />
                Could not load the deep dive.
                <Button variant="ghost" size="sm" onClick={() => oneShot.refetch()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : !data ? (
              <Skeleton className="h-64 w-full rounded-lg" />
            ) : (
              <>
                <CourseLengthSummary data={data} />
                <ConstraintSummary data={data} />
                <ArchetypePerformanceSummary data={data} />

                <div id="chart-style-fingerprint" className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">Shooter style fingerprint</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                          aria-label="About this chart"
                        >
                          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
                        <PopoverHeader>
                          <PopoverTitle>Shooter style fingerprint</PopoverTitle>
                          <PopoverDescription>Match-wide accuracy vs. speed plotted for each competitor.</PopoverDescription>
                        </PopoverHeader>
                        <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                          <p>Both axes are <strong>field percentile ranks</strong> (0–100): X = accuracy rank (A-zone ratio vs. the full field), Y = speed rank (pts/s vs. the full field). A value of 50 means exactly field median.</p>
                          <p>The dashed crosshair is always at (50, 50) — the field median — so each quadrant contains roughly 25 % of the field. Quadrant labels: <strong>Gunslinger</strong> (fast & accurate), <strong>Surgeon</strong> (accurate, leaving time on table), <strong>Speed Demon</strong> (fast, bleeding points), <strong>Grinder</strong> (room to grow).</p>
                          <p>Each competitor gets an archetype badge based on their quadrant. Hover a dot or check the legend to see the archetype with raw values (α%, pts/s) and exact percentile.</p>
                          <p>With fewer than 25 competitors in the field, archetype labels read <em>tends toward X style</em> rather than a definitive label — the quadrant boundaries are less stable with a small cohort. The field size (n) is shown in the tooltip.</p>
                          <p>Faded background dots = field cohort cloud. Use the Field overlay toggle to show all competitors, same division, or none. Dot size ∝ penalty rate.</p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <StyleFingerprintChart data={data} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">Shooter style profile</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                          aria-label="About this chart"
                        >
                          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
                        <PopoverHeader>
                          <PopoverTitle>Shooter style profile</PopoverTitle>
                          <PopoverDescription>Four-axis radar showing where each competitor ranks across key shooting dimensions.</PopoverDescription>
                        </PopoverHeader>
                        <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                          <p><strong>Speed</strong> — points-per-second percentile rank. 100 = fastest scorer in the field.</p>
                          <p><strong>Accuracy</strong> — A-zone ratio percentile rank. 100 = highest proportion of alpha hits.</p>
                          <p><strong>Composure</strong> — inverse penalty-rate rank. 100 = fewest misses, no-shoots, and procedurals per round fired.</p>
                          <p><strong>Consistency</strong> — inverse stage-to-stage hit-factor variability rank. 100 = most repeatable across stages. Shows 50 when only one stage is available.</p>
                          <p>The dashed polygon marks the field median (50th percentile on all axes). A larger polygon means a stronger overall profile.</p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <ShooterStyleRadarChart data={data} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold">Stage degradation</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                          aria-label="About this chart"
                        >
                          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
                        <PopoverHeader>
                          <PopoverTitle>Stage degradation</PopoverTitle>
                          <PopoverDescription>Does shooting position on a stage correlate with performance?</PopoverDescription>
                        </PopoverHeader>
                        <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                          <p>X axis = the order in which each competitor shot this specific stage (1 = first to shoot, N = last). Derived from scorecard submission timestamps.</p>
                          <p>Y axis = HF as % of the stage overall leader (100% = best run). Faded dots = full field; colored dots = your selected competitors.</p>
                          <p>The dashed line is a linear trend. The Spearman r badge summarises how strongly shooting position correlates with performance: negative r means earlier shooters scored higher (stage degraded over the day); positive r means later shooters benefited (e.g., learned from watching).</p>
                          <p>The badge also shows the sample size (n) and whether the correlation is statistically significant at 95% confidence. A non-significant result is shown in muted text — the trend may simply be noise from a small or noisy field rather than a real shooting-order effect.</p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <StageDegradationChart data={data} />
                </div>

                <StageTimesExport
                  ct={ct}
                  id={id}
                  match={match}
                  compareData={data}
                  selectedIds={selectedIds}
                />

                {compareMode === "coaching" && match.scoring_pct >= 80 && (
                <Collapsible open={showSimulator} onOpenChange={onSimulatorOpenChange} className="rounded-lg border p-4">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 font-semibold text-base m-0 leading-none">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          id="stage-simulator-heading"
                          className="flex w-full items-center justify-between text-left gap-2"
                        >
                          <span>
                            Stage Simulator
                            <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                              What-if sandbox — the comparison table above is not affected.
                            </span>
                          </span>
                          {showSimulator ? (
                            <ChevronUp className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                    </h3>
                    {showSimulator && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="flex-none text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            aria-label="About the stage simulator"
                          >
                            <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="end">
                          <PopoverHeader>
                            <PopoverTitle>Stage Simulator</PopoverTitle>
                            <PopoverDescription>
                              Adjust one stage at a time to see how a cleaner run would affect your hit factor, stage percentage, and match rank.
                            </PopoverDescription>
                          </PopoverHeader>
                          <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                            <p>Pick a competitor and stage, then dial in adjustments — faster time, converting misses or no-shoots to A or C hits, upgrading C or D-hits to A-hits, or removing procedural penalties.</p>
                            <p>Adjust multiple stages independently; the match avg and group rank rows show the cumulative impact across all modified stages.</p>
                            <p>Division rank and overall rank (vs the full field) appear below the group rank after a short delay — they reflect the simulated scorecards server-side.</p>
                            <p>Your adjustments are saved per-stage and restored if you refresh the page.</p>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>

                  <CollapsibleContent>
                    <section
                      role="region"
                      aria-labelledby="stage-simulator-heading"
                      className="pt-4"
                    >
                      <StageSimulator
                        ct={ct}
                        id={id}
                        data={data}
                        competitors={data.competitors}
                        scoringCompleted={match.scoring_pct}
                      />
                    </section>
                  </CollapsibleContent>
                </Collapsible>
                )}
              </>
            )}
          </section>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
