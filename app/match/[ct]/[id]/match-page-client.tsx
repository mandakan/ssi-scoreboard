"use client";

import { useCallback, useSyncExternalStore, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MatchHeader } from "@/components/match-header";
import { ShareButton } from "@/components/share-button";
import { ShareEventLink } from "@/components/share-event-link";
import { CompetitorPicker } from "@/components/competitor-picker";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { SquadPicker } from "@/components/squad-picker";
import { BenchmarkPicker } from "@/components/benchmark-picker";
import { ComparisonTable } from "@/components/comparison-table";
import { ModeToggle } from "@/components/mode-toggle";
import { useMatchQuery, useCompareQuery, useCoachingAvailability } from "@/lib/queries";
import { detectMatchView, isPreMatchEligible } from "@/lib/mode";
import type { CompareMode } from "@/lib/types";
import { CacheInfoBadge } from "@/components/cache-info-badge";
import { UpstreamDegradedBanner } from "@/components/upstream-degraded-banner";
import { LoadingBar } from "@/components/loading-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, ArrowLeft, RefreshCw, ChevronDown, ChevronUp, HelpCircle, ExternalLink, Info, ArrowUpDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
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
import { getMyIdentity, getTrackedShooters } from "@/lib/shooter-identity";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { MAX_COMPETITORS } from "@/lib/constants";
import { PreMatchView } from "@/components/pre-match-view";
import { StageTimesExport } from "@/components/stage-times-export";
import { usePreviewFeature } from "@/hooks/use-preview-feature";

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
  const stageExportEnabled = usePreviewFeature("stage-export");
  const [showCoachingView, setShowCoachingView] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const params = useParams<{ ct: string; id: string }>();
  const { ct, id } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  // On mount: reset scroll and move focus to main content for screen readers.
  useEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.focus({ preventScroll: true });
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

  // Identity and tracked shooters (localStorage-backed, reactive).
  const { identity, setIdentity } = useMyIdentity();
  const { tracked: trackedShooters, trackedIds, add: addTracked, remove: removeTracked } =
    useTrackedShooters();

  // Capture mount timestamp once to avoid impure Date.now() in render path.
  const [mountMs] = useState(() => Date.now());

  // Compute auto view from match data (defaults to "coaching" until loaded).
  const matchDateMs = matchQuery.data?.date ? new Date(matchQuery.data.date).getTime() : null;
  const matchEndsMs = matchQuery.data?.ends ? new Date(matchQuery.data.ends).getTime() : null;
  const daysSinceMatchStart =
    matchDateMs != null ? (mountMs - matchDateMs) / 86_400_000 : 0;
  const daysSinceMatchEnd =
    matchEndsMs != null ? (mountMs - matchEndsMs) / 86_400_000 : null;

  // Auto view is computed from match-only data first, then refined once the
  // compare response confirms whether any stage already has scores.
  // (This enables falling back to "live" if `scoring_completed` is still 0
  // but the API has scores — handles rounding / delayed reporting.)
  const autoMode = useMemo(() => {
    if (!matchQuery.data) return "coaching" as const;
    return detectMatchView({
      scoringPct: matchQuery.data.scoring_completed,
      daysSinceMatchStart,
      daysSinceMatchEnd,
      resultsStatus: matchQuery.data.results_status,
      matchStatus: matchQuery.data.match_status,
      hasActualScores: false,
    });
  }, [matchQuery.data, daysSinceMatchStart, daysSinceMatchEnd]);

  const effectiveMode = modeOverride ?? autoMode;

  // Pre-match selectability — offered as a manual choice while the match
  // isn't fully wrapped up. Gated on scoring %, not on dates, so it stays
  // available for multi-day matches where some squads still haven't shot.
  const preMatchEligible = matchQuery.data
    ? isPreMatchEligible({
        scoringPct: matchQuery.data.scoring_completed,
        resultsStatus: matchQuery.data.results_status,
        matchStatus: matchQuery.data.match_status,
      })
    : false;

  // Compare query: skipped when in the pre-match view (no scores to fetch).
  // The mode passed to the API is always "live" or "coaching".
  const compareMode: CompareMode = effectiveMode === "coaching" ? "coaching" : "live";
  const compareEnabled = effectiveMode !== "prematch";
  const compareQuery = useCompareQuery(
    ct,
    id,
    compareEnabled ? selectedIds : EMPTY_IDS,
    compareMode,
  );
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

  // Auto-select tracked/identity competitors once per match visit (only when no existing selection).
  const autoSelectAppliedRef = useRef(false);
  useEffect(() => {
    if (autoSelectAppliedRef.current || !matchQuery.data) return;
    autoSelectAppliedRef.current = true;

    // Only auto-select if no existing selection
    const existing = getCompetitorSelectionSnapshot(ct, id);
    if (existing.length > 0) return;

    // Build shooterId → competitorId map
    const map = new Map<number, number>();
    for (const c of matchQuery.data.competitors) {
      if (c.shooterId !== null) map.set(c.shooterId, c.id);
    }

    // Gather tracked + identity shooter IDs
    const identityNow = getMyIdentity();
    const trackedNow = getTrackedShooters();
    const shooterIds = new Set<number>();
    if (identityNow) shooterIds.add(identityNow.shooterId);
    for (const t of trackedNow) shooterIds.add(t.shooterId);

    // Resolve to match-specific competitor IDs
    const autoIds: number[] = [];
    for (const sId of shooterIds) {
      const cId = map.get(sId);
      if (cId !== undefined) autoIds.push(cId);
    }

    if (autoIds.length > 0) {
      const toAdd = autoIds.slice(0, MAX_COMPETITORS);
      saveCompetitorSelection(ct, id, toAdd);
      router.replace(`?competitors=${toAdd.join(",")}`, { scroll: false });
    }
  }, [ct, id, matchQuery.data, router]);

  // Tracked-in-match indicator: how many tracked/identity shooters are in this match.
  const trackedInMatch = useMemo(() => {
    if (!matchQuery.data) return null;
    const map = new Map(
      matchQuery.data.competitors
        .filter((c) => c.shooterId !== null)
        .map((c) => [c.shooterId!, c.id]),
    );
    const allTrackedIds = [
      ...(identity ? [identity.shooterId] : []),
      ...trackedShooters.map((t) => t.shooterId),
    ];
    const total = allTrackedIds.length;
    const present = allTrackedIds.filter((sid) => map.has(sid)).length;
    return total > 0 ? { present, total } : null;
  }, [matchQuery.data, trackedShooters, identity]);

  function handleSetMyIdentity(c: { shooterId: number | null; name: string }) {
    if (c.shooterId === null) return;
    setIdentity({ shooterId: c.shooterId, name: c.name, license: null });
  }

  function handleToggleTracked(c: { shooterId: number | null; name: string; club: string | null; division: string | null }) {
    if (c.shooterId === null) return;
    if (trackedIds.has(c.shooterId)) {
      removeTracked(c.shooterId);
    } else if (trackedShooters.length < MAX_COMPETITORS) {
      addTracked({ shooterId: c.shooterId, name: c.name, club: c.club, division: c.division });
    }
  }

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
      <main id="main-content" tabIndex={-1} className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
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
      </main>
      </>
    );
  }

  if (matchQuery.isError || !matchQuery.data) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-destructive font-medium" role="alert">
          {matchQuery.error?.message ?? "Failed to load match"}
        </p>
        <Button variant="outline" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      </main>
    );
  }

  const match = matchQuery.data;

  // results_status === "all" is the definitive "published" signal from SSI.
  const isMatchComplete = match.results_status === "all" || effectiveMode === "coaching";
  const resultsPublished = match.results_status === "all";
  const matchCancelled = match.match_status === "cs";
  const aiAvailable = coachingAvailability.data?.available === true;
  // The active view drives what's rendered. Auto-detection chooses pre-match
  // when scoring hasn't really started; the user can override via ModeToggle
  // (e.g. early squads have finished but their afternoon/day-2 squad hasn't).
  const isPreMatch = effectiveMode === "prematch";

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

  // Either response can flag the upstream as degraded. Show the banner when
  // any active query reports it — disappears as soon as a fresh response lands.
  const upstreamDegraded =
    match.cacheInfo.upstreamDegraded === true ||
    compareQuery.data?.cacheInfo.upstreamDegraded === true;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen p-4 sm:p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">
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
          <CacheInfoBadge
            ct={ct}
            id={id}
            cachedAt={stalestCachedAt}
            lastScorecardAt={compareQuery.data?.cacheInfo.lastScorecardAt ?? null}
            phase={
              effectiveMode === "prematch"
                ? "prematch"
                : effectiveMode === "coaching"
                  ? "finished"
                  : "live"
            }
            isRefreshing={matchQuery.isFetching || compareQuery.isFetching}
          />
          <ShareEventLink ct={ct} id={id} matchName={match.name} />
          <ShareButton title={match.name} competitorCount={selectedIds.length} />
        </div>
      </div>

      {/* Upstream degraded banner — shown when SSI is failing and we're serving stale data */}
      {upstreamDegraded && (
        <UpstreamDegradedBanner cachedAt={stalestCachedAt} />
      )}

      {/* Match header */}
      <MatchHeader match={match} />

      {/* Results disclaimer — shown whenever SSI has not publicly published results (not for pre-match) */}
      {!resultsPublished && !isPreMatch && (
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

      {/* View toggle — pre-match / live / coaching. Pre-match stays available
          while the match is in progress so users in late squads can still see
          squad rotation, weather, and field info. */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <ModeToggle
            autoMode={autoMode}
            effectiveMode={effectiveMode}
            preMatchEligible={preMatchEligible}
            onModeChange={(mode) => saveModeOverride(ct, id, mode)}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                aria-label="About pre-match, live, and coaching views"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80" side="bottom" align="start">
              <PopoverHeader>
                <PopoverTitle>Pre-match, Live, and Coaching</PopoverTitle>
                <PopoverDescription>The app picks a view based on match state. You can override it.</PopoverDescription>
              </PopoverHeader>
              <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                <p><strong>Pre-match</strong> — squad rotation, weather, registered field, and AI brief. Useful when your squad hasn&apos;t shot yet, even if early squads have finished.</p>
                <p><strong>Live</strong> — for active matches. Refreshes every 30 seconds. Shows stage results, charts, and core stats only. Skips heavy analytics to keep things fast courtside.</p>
                <p><strong>Coaching</strong> — for completed matches. Full analysis: style fingerprints, archetype breakdown, course-length splits, constraint performance, and the stage simulator.</p>
                <p>The view is auto-detected: pre-match before scoring really gets going, live once scoring is underway, and coaching for ≥ 95% scored or matches older than 3 days. Tap any mode to override, or tap the active mode to reset to auto.</p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs text-muted-foreground">
          {effectiveMode === "prematch"
            ? "Squad rotation, weather, and registered field. No scores shown."
            : effectiveMode === "live"
            ? "Fast refresh, stage-focused view. Coaching analytics hidden."
            : "Full analysis with style fingerprints, breakdowns, and simulator."}
        </p>
      </div>

      {/* Competitor picker */}
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm font-medium">Compare competitors</p>
          {trackedInMatch && trackedInMatch.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {trackedInMatch.present} of {trackedInMatch.total} tracked in this match
            </span>
          )}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <CompetitorPicker
            competitors={match.competitors}
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
            myShooterId={identity?.shooterId ?? null}
            trackedShooterIds={trackedIds}
            onSetMyIdentity={handleSetMyIdentity}
            onToggleTracked={handleToggleTracked}
            onManage={() => setShowManage(true)}
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

      {/* Pre-match view — replaces comparison when no scores yet */}
      {isPreMatch && (
        <PreMatchView
          match={match}
          selectedIds={selectedIds}
          trackedShooterIds={trackedIds}
          myShooterId={identity?.shooterId ?? null}
          ct={ct}
          id={id}
          aiAvailable={aiAvailable}
          onManageShooters={() => setShowManage(true)}
        />
      )}

      {/* Comparison views */}
      {!isPreMatch && selectedIds.length > 0 && (
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
            <div role="alert" className="flex items-center gap-2 text-destructive text-sm">
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
                          <p>Hover a stage bar to see the number of competitors contributing to that distribution. The legend shows the n range across all stages — a narrow band from a small field (e.g. n=4) is less reliable than one from a large field.</p>
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
                  <Collapsible open={showCoachingView} onOpenChange={setShowCoachingView} className="rounded-lg border p-4 space-y-3">
                    {/* WAI-ARIA accordion pattern: heading wraps the disclosure button */}
                    <h2 className="font-semibold text-base m-0 leading-none">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          id="coaching-view-heading"
                          className="flex w-full items-center justify-between text-left gap-2"
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
                      </CollapsibleTrigger>
                    </h2>

                    <CollapsibleContent>
                      <section
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
                                  <p>With fewer than 25 competitors in the field, archetype labels read <em>tends toward X style</em> rather than a definitive label — the quadrant boundaries are less stable with a small cohort. The field size (n) is shown in the tooltip.</p>
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
                                  <p>The dashed line is a linear trend. The Spearman r badge summarises how strongly shooting position correlates with performance: negative r means earlier shooters scored higher (stage degraded over the day); positive r means later shooters benefited (e.g., learned from watching).</p>
                                  <p>The badge also shows the sample size (n) and whether the correlation is statistically significant at 95% confidence. A non-significant result is shown in muted text — the trend may simply be noise from a small or noisy field rather than a real shooting-order effect.</p>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                          <StageDegradationChart data={compareQuery.data} />
                        </div>

                        {stageExportEnabled && (
                          <StageTimesExport
                            ct={ct}
                            id={id}
                            match={match}
                            compareData={compareQuery.data}
                            selectedIds={selectedIds}
                          />
                        )}
                      </section>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Stage Simulator — collapsed by default, only ≥ 80% complete */}
                  {match.scoring_completed >= 80 && (
                    <Collapsible open={showSimulator} onOpenChange={setShowSimulator} className="rounded-lg border p-4">
                      <div className="flex items-start gap-2">
                        <h2 className="flex-1 font-semibold text-base m-0 leading-none">
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

                      <CollapsibleContent>
                        <section
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
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {!isPreMatch && selectedIds.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Select one or more competitors above to see the comparison.
        </p>
      )}

      <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
    </main>
  );
}
