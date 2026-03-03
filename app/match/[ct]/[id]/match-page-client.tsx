"use client";

import { useCallback, useSyncExternalStore, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MatchHeader } from "@/components/match-header";
import { ShareButton } from "@/components/share-button";
import { CompetitorPicker } from "@/components/competitor-picker";
import { SquadPicker } from "@/components/squad-picker";
import { BenchmarkPicker } from "@/components/benchmark-picker";
import { ComparisonTable } from "@/components/comparison-table";
import { ModeToggle } from "@/components/mode-toggle";
import { useMatchQuery, useCompareQuery, useCoachingAvailability } from "@/lib/queries";
import { detectMode } from "@/lib/mode";
import { CacheInfoBadge } from "@/components/cache-info-badge";
import { LoadingBar } from "@/components/loading-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, ArrowLeft, RefreshCw, ChevronDown, ChevronUp, HelpCircle, ExternalLink, Info, ArrowUpDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import {
  saveRecentCompetition,
  saveCompetitorSelection,
  getCompetitorSelectionSnapshot,
  SELECTION_CHANGED,
  saveModeOverride,
  getModeOverrideSnapshot,
  subscribeMode,
} from "@/lib/competition-store";

// Stable empty array for useSyncExternalStore server snapshot — must be a
// constant reference so React's referential equality check doesn't loop.
const EMPTY_IDS: number[] = [];

const ChartSkeleton = () => <Skeleton className="h-64 w-full rounded-lg" />;

const ComparisonChart = dynamic(
  () => import("@/components/comparison-chart").then((m) => m.ComparisonChart),
  { ssr: false, loading: ChartSkeleton },
);
const HfPercentChart = dynamic(
  () => import("@/components/hf-percent-chart").then((m) => m.HfPercentChart),
  { ssr: false, loading: ChartSkeleton },
);
const SpeedAccuracyChart = dynamic(
  () => import("@/components/scatter-chart").then((m) => m.SpeedAccuracyChart),
  { ssr: false, loading: ChartSkeleton },
);
const StageBalanceChart = dynamic(
  () => import("@/components/radar-chart").then((m) => m.StageBalanceChart),
  { ssr: false, loading: ChartSkeleton },
);
const StyleFingerprintChart = dynamic(
  () =>
    import("@/components/style-fingerprint-chart").then(
      (m) => m.StyleFingerprintChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);
const ArchetypePerformanceSummary = dynamic(
  () =>
    import("@/components/archetype-performance").then(
      (m) => m.ArchetypePerformanceSummary,
    ),
  { ssr: false },
);
const CourseLengthSummary = dynamic(
  () =>
    import("@/components/course-performance").then(
      (m) => m.CourseLengthSummary,
    ),
  { ssr: false },
);
const ConstraintSummary = dynamic(
  () =>
    import("@/components/course-performance").then(
      (m) => m.ConstraintSummary,
    ),
  { ssr: false },
);
const ShooterStyleRadarChart = dynamic(
  () =>
    import("@/components/shooter-style-radar-chart").then(
      (m) => m.ShooterStyleRadarChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);
const StageDegradationChart = dynamic(
  () =>
    import("@/components/stage-degradation-chart").then(
      (m) => m.StageDegradationChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);
const StageSimulator = dynamic(
  () => import("@/components/stage-simulator").then((m) => m.StageSimulator),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full rounded-lg" /> },
);
const DivisionDistributionChart = dynamic(
  () =>
    import("@/components/division-distribution-chart").then(
      (m) => m.DivisionDistributionChart,
    ),
  { ssr: false, loading: ChartSkeleton },
);

export default function MatchPageClient() {
  const [showCoachingView, setShowCoachingView] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const params = useParams<{ ct: string; id: string }>();
  const { ct, id } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  // On mount: reset scroll position to top so navigating from a scrolled landing
  // page doesn't land mid-page on the match view.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // On mount: seed localStorage from ?competitors= URL param (shared links),
  // or reflect existing localStorage selection into the URL (backward compat).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const competitorsParam = searchParams.get("competitors");
    if (competitorsParam) {
      const ids = competitorsParam
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length > 0) {
        saveCompetitorSelection(ct, id, ids);
      }
    } else {
      const localIds = getCompetitorSelectionSnapshot(ct, id);
      if (localIds.length > 0) {
        router.replace(`?competitors=${localIds.join(",")}`, { scroll: false });
      }
    }
  }, [ct, id, searchParams, router]);

  // Use useSyncExternalStore to read competitor selection from localStorage.
  // This handles SSR (server snapshot = []) and client-side hydration correctly,
  // and avoids setState-in-effect for restoration.
  const selectedIds = useSyncExternalStore(
    useCallback(
      (onChange) => {
        const handler = (e: Event) => {
          const ev = e as CustomEvent<{ ct: string; id: string }>;
          if (ev.detail?.ct === ct && ev.detail?.id === id) onChange();
        };
        window.addEventListener(SELECTION_CHANGED, handler);
        return () => window.removeEventListener(SELECTION_CHANGED, handler);
      },
      [ct, id]
    ),
    useCallback(() => getCompetitorSelectionSnapshot(ct, id), [ct, id]),
    () => EMPTY_IDS
  );

  // Mode override from localStorage (useSyncExternalStore for SSR safety).
  const modeOverride = useSyncExternalStore(
    subscribeMode,
    useCallback(() => getModeOverrideSnapshot(ct, id), [ct, id]),
    () => null,
  );

  const matchQuery = useMatchQuery(ct, id);

  // Capture mount timestamp once to avoid impure Date.now() in render path.
  const [mountMs] = useState(() => Date.now());

  // Compute auto mode from match data (defaults to "coaching" until loaded).
  const matchDateMs = matchQuery.data?.date ? new Date(matchQuery.data.date).getTime() : null;
  const autoMode = matchQuery.data
    ? detectMode(
        matchQuery.data.scoring_completed,
        matchDateMs != null ? (mountMs - matchDateMs) / 86_400_000 : 0,
      )
    : "coaching";
  const effectiveMode = modeOverride ?? autoMode;

  const compareQuery = useCompareQuery(ct, id, selectedIds, effectiveMode);
  const coachingAvailability = useCoachingAvailability();

  // ── Stage sort (shared by table + charts) ─────────────────────────────────
  const [stageSort, setStageSort] = useState<"stage" | number>("stage");
  const stageSortAutoAppliedRef = useRef(false);

  // Smart defaults: auto-apply single competitor's shooting order on first load;
  // reset to stage order when sorted competitor is removed or second is added.
  useEffect(() => {
    if (!compareQuery.data) return;
    const { competitors, stages } = compareQuery.data;
    setStageSort((prev) => {
      if (!stageSortAutoAppliedRef.current) {
        stageSortAutoAppliedRef.current = true;
        if (competitors.length === 1) {
          const comp = competitors[0];
          if (stages.some((s) => s.competitors[comp.id]?.shooting_order != null)) {
            return comp.id;
          }
        }
        return prev;
      }
      if (prev === "stage") return prev;
      const currIds = new Set(competitors.map((c) => c.id));
      if (!currIds.has(prev) || currIds.size > 1) return "stage";
      return prev;
    });
  }, [compareQuery.data]);

  // First name of the competitor whose shooting order is active, or null.
  const sortedCompName = useMemo(() => {
    if (stageSort === "stage" || !compareQuery.data) return null;
    return compareQuery.data.competitors.find((c) => c.id === stageSort)?.name.split(" ")[0] ?? null;
  }, [stageSort, compareQuery.data]);

  const sortedStages = useMemo(() => {
    const stages = compareQuery.data?.stages ?? [];
    if (stageSort === "stage") return stages;
    return [...stages].sort((a, b) => {
      const orderA = a.competitors[stageSort]?.shooting_order ?? null;
      const orderB = b.competitors[stageSort]?.shooting_order ?? null;
      if (orderA != null && orderB != null) return orderA - orderB;
      if (orderA != null) return -1;
      if (orderB != null) return 1;
      return a.stage_num - b.stage_num;
    });
  }, [compareQuery.data?.stages, stageSort]);
  // ─────────────────────────────────────────────────────────────────────────

  // Save match to recents whenever data loads/changes (localStorage write, no setState).
  useEffect(() => {
    if (matchQuery.data) {
      saveRecentCompetition(ct, id, matchQuery.data);
    }
  }, [ct, id, matchQuery.data]);

  function handleSelectionChange(ids: number[]) {
    saveCompetitorSelection(ct, id, ids);
    // Sync selection to URL so it can be bookmarked or shared.
    const qs = ids.length > 0 ? `?competitors=${ids.join(",")}` : "";
    router.replace(`${window.location.pathname}${qs}`, { scroll: false });
  }

  if (matchQuery.isLoading) {
    return (
      <>
      <LoadingBar matchLoaded={false} compareLoaded={false} hasCompetitors={selectedIds.length > 0} />
      <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        {/* nav row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>

        {/* match header */}
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <div className="flex gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* stage list */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
        </div>

        {/* competitor picker */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
      </>
    );
  }

  if (matchQuery.isError || !matchQuery.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-destructive font-medium">
          {matchQuery.error?.message ?? "Failed to load match"}
        </p>
        <Button variant="outline" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      </div>
    );
  }

  const match = matchQuery.data;

  // results_status === "all" is the definitive "published" signal from SSI.
  const isMatchComplete = match.results_status === "all" || effectiveMode === "coaching";
  const resultsPublished = match.results_status === "all";
  const matchCancelled = match.match_status === "cs";
  const aiAvailable = coachingAvailability.data?.available === true;

  // Pick the older (more stale) cachedAt between match and compare responses.
  // null means "just fetched live" — prefer non-null if one is cached.
  const matchCachedAt = match.cacheInfo.cachedAt;
  const compareCachedAt = compareQuery.data?.cacheInfo.cachedAt ?? null;
  const stalestCachedAt =
    matchCachedAt && compareCachedAt
      ? new Date(matchCachedAt) < new Date(compareCachedAt)
        ? matchCachedAt
        : compareCachedAt
      : matchCachedAt ?? compareCachedAt;

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <LoadingBar
        matchLoaded={true}
        compareLoaded={!!compareQuery.data}
        hasCompetitors={selectedIds.length > 0}
      />
      {/* Back link + share */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          All matches
        </Link>
        <div className="flex items-center gap-3">
          <CacheInfoBadge ct={ct} id={id} cachedAt={stalestCachedAt} />
          <ShareButton title={match.name} competitorCount={selectedIds.length} />
        </div>
      </div>

      {/* Match header */}
      <MatchHeader match={match} />

      {/* Results disclaimer — shown whenever SSI has not publicly published results */}
      {!resultsPublished && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span>
            {matchCancelled
              ? "This match was cancelled."
              : "Results are not yet officially published by the organizers — data shown here may change."
            }
            {match.ssi_url && !matchCancelled && (
              <>
                {" "}
                <a
                  href={match.ssi_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-100"
                >
                  ShootNScoreIt is the source of truth
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
                .
              </>
            )}
          </span>
        </div>
      )}

      {/* Mode toggle */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <ModeToggle
            autoMode={autoMode}
            effectiveMode={effectiveMode}
            onModeChange={(mode) => saveModeOverride(ct, id, mode)}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                aria-label="About live and coaching modes"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80" side="bottom" align="start">
              <PopoverHeader>
                <PopoverTitle>Live vs Coaching mode</PopoverTitle>
                <PopoverDescription>The app picks a mode based on match state. You can override it.</PopoverDescription>
              </PopoverHeader>
              <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                <p><strong>Live</strong> — for active matches. Refreshes every 30 seconds. Shows stage results, charts, and core stats only. Skips heavy analytics to keep things fast courtside.</p>
                <p><strong>Coaching</strong> — for completed matches. Full analysis: style fingerprints, archetype breakdown, course-length splits, constraint performance, and the stage simulator.</p>
                <p>The mode is auto-detected: matches with ≥ 95% scored or older than 3 days default to Coaching. Tap the other mode to override, or tap the active mode to reset to auto.</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-muted-foreground">
          {effectiveMode === "live"
            ? "Fast refresh, stage-focused view. Coaching analytics hidden."
            : "Full analysis with style fingerprints, breakdowns, and simulator."}
        </p>
      </div>

      {/* Competitor picker */}
      <div className="space-y-1">
        <p className="text-sm font-medium">Compare competitors</p>
        <div className="flex items-start gap-2 flex-wrap">
          <CompetitorPicker
            competitors={match.competitors}
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
          />
          {match.squads.length > 0 && (
            <SquadPicker
              squads={match.squads}
              selectedIds={selectedIds}
              onSelectionChange={handleSelectionChange}
            />
          )}
          {selectedIds.length > 0 && (
            <BenchmarkPicker
              fieldFingerprintPoints={
                compareQuery.data?.fieldFingerprintPoints ?? []
              }
              competitors={match.competitors}
              selectedIds={selectedIds}
              onSelectionChange={handleSelectionChange}
              disabled={!compareQuery.data}
            />
          )}
        </div>
      </div>

      {/* Comparison views */}
      {selectedIds.length > 0 && (
        <div className="space-y-6">
          {compareQuery.isLoading && (
            <div className="rounded-lg border p-4 space-y-3">
              <Skeleton className="h-5 w-28" />
              {/* table header */}
              <div className="flex gap-2">
                <Skeleton className="h-4 w-20" />
                {Array.from({ length: selectedIds.length }).map((_, i) => (
                  <Skeleton key={i} className="h-4 flex-1" />
                ))}
              </div>
              {/* rows */}
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="h-14 w-20" />
                  {Array.from({ length: selectedIds.length }).map((_, j) => (
                    <Skeleton key={j} className="h-14 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          )}

          {compareQuery.isError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {compareQuery.error?.message ?? "Failed to load comparison"}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => compareQuery.refetch()}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {compareQuery.data && (
            <>
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Stage results</h2>
                  {compareQuery.isFetching && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Refreshing…
                    </span>
                  )}
                </div>
                <ComparisonTable
                  data={compareQuery.data}
                  scoringCompleted={match.scoring_completed}
                  onRemove={(id) => handleSelectionChange(selectedIds.filter((s) => s !== id))}
                  aiAvailable={aiAvailable}
                  isComplete={isMatchComplete}
                  ct={ct}
                  matchId={id}
                  stageSort={stageSort}
                  onSortChange={setStageSort}
                  sortedStages={sortedStages}
                />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold">
                    Hit factor by stage
                    {sortedCompName && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {sortedCompName}&apos;s shooting order</span>
                    )}
                  </h2>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        aria-label="About this chart"
                      >
                        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" side="bottom" align="start">
                      <PopoverHeader>
                        <PopoverTitle>Hit factor by stage</PopoverTitle>
                        <PopoverDescription>Bar height = hit factor (points ÷ time) for each stage. Higher is always better.</PopoverDescription>
                      </PopoverHeader>
                      <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                        <p>The dashed line (field leader) and dotted line (field median) benchmark your group against the full match field — toggle them with the buttons above the chart.</p>
                        <p>DNF and DQ runs appear at HF 0 with reduced opacity.</p>
                        <p>Click a competitor name in the legend to show or hide their bars.</p>
                        <p>Stages appear in the same order as the comparison table. Use the <ArrowUpDown className="inline w-3 h-3 align-middle" aria-hidden="true" /><span className="sr-only">sort</span> button in a competitor&apos;s column header to sort by their shooting order — this chart will follow.</p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <ComparisonChart data={compareQuery.data} stages={sortedStages} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold">
                    HF% vs stage winner
                    {sortedCompName && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {sortedCompName}&apos;s shooting order</span>
                    )}
                  </h2>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        aria-label="About this chart"
                      >
                        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" side="bottom" align="start">
                      <PopoverHeader>
                        <PopoverTitle>HF% vs stage winner</PopoverTitle>
                        <PopoverDescription>Your hit factor as a percentage of the reference, per stage. 100% = you matched the winner.</PopoverDescription>
                      </PopoverHeader>
                      <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                        <p>Colour bands: green ≥ 95%, amber 85–95%, red &lt; 85% indicate run quality zones.</p>
                        <p>Use the reference buttons above the chart to switch from &ldquo;stage winner&rdquo; to any specific competitor to compare gaps directly.</p>
                        <p>Percentages control for relative HF level — a short stage and a long stage at 90% represent equal relative performance.</p>
                        <p>Stages appear in the same order as the comparison table. Use the <ArrowUpDown className="inline w-3 h-3 align-middle" aria-hidden="true" /><span className="sr-only">sort</span> button in a competitor&apos;s column header to sort by their shooting order — this chart will follow.</p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <HfPercentChart data={compareQuery.data} stages={sortedStages} />
              </div>

              {compareQuery.data.stages.some(
                (s) => Object.keys(s.divisionDistributions ?? {}).length > 0
              ) && (
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <h2 className="font-semibold">
                      Division position
                      {sortedCompName && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {sortedCompName}&apos;s shooting order</span>
                      )}
                    </h2>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                          aria-label="About this chart"
                        >
                          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" side="bottom" align="start">
                        <PopoverHeader>
                          <PopoverTitle>Division position</PopoverTitle>
                          <PopoverDescription>Where each competitor sits within their division&apos;s HF distribution per stage — as a percentage of the division winner.</PopoverDescription>
                        </PopoverHeader>
                        <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                          <p>The shaded band shows where the middle 50% of the division scored (Q1–Q3). The dashed line is the division median, and the faint dotted line is the division minimum.</p>
                          <p>A competitor sitting above the band outperformed most of their division on that stage; below the band means they trailed the majority.</p>
                          <p>Compare stages where your line dips below the band — those are disproportionate opportunities relative to peers in the same division.</p>
                          <p>When competitors are in different divisions, use the selector to switch between them.</p>
                          <p>Stages appear in the same order as the comparison table. Use the <ArrowUpDown className="inline w-3 h-3 align-middle" aria-hidden="true" /><span className="sr-only">sort</span> button in a competitor&apos;s column header to sort by their shooting order — this chart will follow.</p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <DivisionDistributionChart data={compareQuery.data} stages={sortedStages} />
                </div>
              )}

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold">Speed vs. accuracy</h2>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        aria-label="About this chart"
                      >
                        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" side="bottom" align="start">
                      <PopoverHeader>
                        <PopoverTitle>Speed vs. accuracy</PopoverTitle>
                        <PopoverDescription>Each point is one stage: X-axis = time taken, Y-axis = points scored.</PopoverDescription>
                      </PopoverHeader>
                      <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                        <p>Up and to the left is better — more points, less time.</p>
                        <p>Diagonal iso-HF lines connect all time/points combinations with the same hit factor. A stage dot above the &ldquo;HF 6&rdquo; line means you achieved better than HF 6 on that stage.</p>
                        <p>Look for stages where you drifted right (slow) or dropped down (lost points) relative to your usual cluster — those are your biggest improvement opportunities.</p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <SpeedAccuracyChart data={compareQuery.data} />
              </div>

              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold">Stage balance</h2>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        aria-label="About this chart"
                      >
                        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80" side="bottom" align="start">
                      <PopoverHeader>
                        <PopoverTitle>Stage balance</PopoverTitle>
                        <PopoverDescription>Radar polygon showing your percentage per stage. A uniform shape means consistent performance.</PopoverDescription>
                      </PopoverHeader>
                      <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                        <p>Each spoke is one stage; distance from the centre = your % of the reference.</p>
                        <p>Inward dips are stages where you under-performed; outward spikes are strong stages.</p>
                        <p>Switch between Group %, Division %, and Overall % using the toggle inside the chart. Toggle competitors on/off to compare polygon shapes side-by-side.</p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <StageBalanceChart data={compareQuery.data} />
              </div>

              {/* Coaching sections — only rendered in coaching mode */}
              {effectiveMode === "coaching" && (
                <>
                  {/* Coaching / analysis view — hidden by default */}
                  <div className="rounded-lg border p-4 space-y-3">
                    {/* WAI-ARIA accordion pattern: heading wraps the disclosure button */}
                    <h2 className="font-semibold text-base m-0 leading-none">
                      <button
                        type="button"
                        id="coaching-view-heading"
                        onClick={() => setShowCoachingView((v) => !v)}
                        className="flex w-full items-center justify-between text-left gap-2"
                        aria-expanded={showCoachingView}
                        aria-controls="coaching-view-panel"
                      >
                        <span>
                          Coaching analysis
                          <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                            Post-match aggregate view — not recommended during active shooting.
                          </span>
                        </span>
                        {showCoachingView ? (
                          <ChevronUp className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                        )}
                      </button>
                    </h2>

                    {showCoachingView && (
                      <section
                        id="coaching-view-panel"
                        role="region"
                        aria-labelledby="coaching-view-heading"
                        className="space-y-6 pt-2"
                      >

                        <CourseLengthSummary data={compareQuery.data} />
                        <ConstraintSummary data={compareQuery.data} />
                        <ArchetypePerformanceSummary data={compareQuery.data} />

                        <div className="space-y-2">
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
                              <PopoverContent className="w-80" side="bottom" align="start">
                                <PopoverHeader>
                                  <PopoverTitle>Shooter style fingerprint</PopoverTitle>
                                  <PopoverDescription>Match-wide accuracy vs. speed plotted for each competitor.</PopoverDescription>
                                </PopoverHeader>
                                <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                                  <p>Both axes are <strong>field percentile ranks</strong> (0–100): X = accuracy rank (A-zone ratio vs. the full field), Y = speed rank (pts/s vs. the full field). A value of 50 means exactly field median.</p>
                                  <p>The dashed crosshair is always at (50, 50) — the field median — so each quadrant contains roughly 25 % of the field. Quadrant labels: <strong>Gunslinger</strong> (fast & accurate), <strong>Surgeon</strong> (accurate, leaving time on table), <strong>Speed Demon</strong> (fast, bleeding points), <strong>Grinder</strong> (room to grow).</p>
                                  <p>Each competitor gets an archetype badge based on their quadrant. Hover a dot or check the legend to see the archetype with raw values (α%, pts/s) and exact percentile.</p>
                                  <p>Faded background dots = field cohort cloud. Use the Field overlay toggle to show all competitors, same division, or none. Dot size ∝ penalty rate.</p>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <StyleFingerprintChart data={compareQuery.data} />
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
                              <PopoverContent className="w-80" side="bottom" align="start">
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
                          <ShooterStyleRadarChart data={compareQuery.data} />
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
                              <PopoverContent className="w-80" side="bottom" align="start">
                                <PopoverHeader>
                                  <PopoverTitle>Stage degradation</PopoverTitle>
                                  <PopoverDescription>Does shooting position on a stage correlate with performance?</PopoverDescription>
                                </PopoverHeader>
                                <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                                  <p>X axis = the order in which each competitor shot this specific stage (1 = first to shoot, N = last). Derived from scorecard submission timestamps.</p>
                                  <p>Y axis = HF as % of the stage overall leader (100% = best run). Faded dots = full field; colored dots = your selected competitors.</p>
                                  <p>The dashed line is a linear trend. The Spearman r badge shows how strongly shooting position correlates with performance: negative r means earlier shooters scored higher (stage degraded over the day); positive r means later shooters benefited (e.g., learned from watching).</p>
                                  <p>Values near 0 (|r| &lt; 0.1) mean no meaningful shooting-order effect on this stage.</p>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <StageDegradationChart data={compareQuery.data} />
                        </div>
                      </section>
                    )}
                  </div>

                  {/* Stage Simulator — collapsed by default, only ≥ 80% complete */}
                  {match.scoring_completed >= 80 && (
                    <div className="rounded-lg border p-4">
                      <div className="flex items-start gap-2">
                        <h2 className="flex-1 font-semibold text-base m-0 leading-none">
                          <button
                            type="button"
                            id="stage-simulator-heading"
                            onClick={() => setShowSimulator((v) => !v)}
                            className="flex w-full items-center justify-between text-left gap-2"
                            aria-expanded={showSimulator}
                            aria-controls="stage-simulator-panel"
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
                        </h2>
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
                            <PopoverContent className="w-80" side="bottom" align="end">
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

                      {showSimulator && (
                        <section
                          id="stage-simulator-panel"
                          role="region"
                          aria-labelledby="stage-simulator-heading"
                          className="pt-4"
                        >
                          <StageSimulator
                            ct={ct}
                            id={id}
                            data={compareQuery.data}
                            competitors={compareQuery.data.competitors}
                            scoringCompleted={match.scoring_completed}
                          />
                        </section>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {selectedIds.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Select one or more competitors above to see the comparison.
        </p>
      )}
    </div>
  );
}
