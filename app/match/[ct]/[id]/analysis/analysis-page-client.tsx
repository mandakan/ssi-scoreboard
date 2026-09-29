"use client";

import { useCallback, useSyncExternalStore, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ShareButton } from "@/components/share-button";
import { CompetitorPicker } from "@/components/competitor-picker";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { SquadPicker } from "@/components/squad-picker";
import { BenchmarkPicker } from "@/components/benchmark-picker";
import { ComparisonTable } from "@/components/comparison-table";
import { useMatch } from "@/components/match-gate";
import { useCompareQuery, useCoachingAvailability, useShooterDashboardQuery } from "@/lib/queries";
import { computeCareerBaseline } from "@/lib/career-baseline";
import { analysisCompareMode, initialAnalysisSelection } from "@/lib/analysis-selection";
import { CacheInfoBadge } from "@/components/cache-info-badge";
import { UpstreamDegradedBanner } from "@/components/upstream-degraded-banner";
import { LoadingBar } from "@/components/loading-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronUp, HelpCircle, ExternalLink, ArrowUpDown, Undo2, XCircle } from "lucide-react";
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
  saveCompetitorSelection,
  getCompetitorSelectionSnapshot,
  getGridSourcePreference,
  SELECTION_CHANGED,
} from "@/lib/competition-store";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { MAX_COMPETITORS } from "@/lib/constants";
import { resolveGridRows } from "@/lib/live-grid-rows";
import { StageTimesExport } from "@/components/stage-times-export";
import { computeFocusAreas } from "@/lib/coaching-rules";
import { trackUi } from "@/lib/ui-telemetry";

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
const FocusAreasSection = dynamic(
  () =>
    import("@/components/focus-areas-section").then(
      (m) => m.FocusAreasSection,
    ),
  { ssr: false },
);

export default function AnalysisPageClient() {
  const { ct, id, match, isFetching } = useMatch();

  const [showCoachingView, setShowCoachingView] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [showManage, setShowManage] = useState(false);

  // Section-open telemetry counts only the closed->open transition.
  const onCoachingOpenChange = useCallback(
    (open: boolean) => {
      setShowCoachingView(open);
      if (open) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "deep-dive" });
      }
    },
    [ct],
  );
  const onSimulatorOpenChange = useCallback(
    (open: boolean) => {
      setShowSimulator(open);
      if (open) {
        trackUi({ op: "analysis-section-open", ct: parseInt(ct, 10), section: "simulator" });
      }
    },
    [ct],
  );

  const searchParams = useSearchParams();
  const router = useRouter();

  // Identity and tracked shooters (localStorage-backed, reactive).
  const { identity, setIdentity } = useMyIdentity();
  const { tracked: trackedShooters, trackedIds, add: addTracked, remove: removeTracked } =
    useTrackedShooters();

  // Career baseline: fetch the identity's dashboard only when they are one
  // of the selected competitors. The query is disabled when shooterId is null
  // (anonymous viewer) or when match data hasn't loaded yet.
  const shooterDashQuery = useShooterDashboardQuery(identity?.shooterId ?? null);
  const careerBaseline =
    shooterDashQuery.data ? computeCareerBaseline(shooterDashQuery.data.matches) : null;

  // Grid rows, resolved exactly as the grid does, so Analysis opens on the
  // shooters the user was just looking at (spec Section 1, decision 4).
  const gridRows = useMemo(
    () =>
      resolveGridRows({
        source: getGridSourcePreference(ct, id),
        competitors: match.competitors,
        squads: match.squads,
        myShooterId: identity?.shooterId ?? null,
        trackedShooterIds: trackedIds,
        fallback: EMPTY_IDS,
      }),
    [ct, id, match, identity, trackedIds],
  );

  // Use useSyncExternalStore to read competitor selection from localStorage.
  // This handles SSR (server snapshot = []) and client-side hydration correctly,
  // and avoids setState-in-effect for restoration.
  const savedIds = useSyncExternalStore(
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

  // Selection on arrival: URL, then saved, then the grid's rows (see
  // initialAnalysisSelection). Derived at render rather than copied into state,
  // and never persisted while it is only seeded from the grid rows: persisting
  // would pin the next visit (and the grid's fallback) to a list the user never
  // chose. Once the user edits, the saved selection is the source of truth.
  const [edited, setEdited] = useState(false);
  const urlParam = searchParams.get("competitors") ?? "";
  const urlIds = useMemo(
    () => urlParam.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0),
    [urlParam],
  );
  const initial = useMemo(
    () => initialAnalysisSelection({ urlIds, savedIds, gridRows }),
    [urlIds, savedIds, gridRows],
  );
  const selectedIds = edited ? savedIds : initial.ids.length > 0 ? initial.ids : EMPTY_IDS;

  // Arrival sync: persist an explicit shared-link selection, or reflect the
  // saved/seeded selection into the URL. Each runs at most once per visit.
  const arrivalHandledRef = useRef(false);
  useEffect(() => {
    if (edited || arrivalHandledRef.current) return;
    if (urlIds.length > 0) {
      arrivalHandledRef.current = true;
      saveCompetitorSelection(ct, id, urlIds);
    } else if (initial.ids.length > 0) {
      arrivalHandledRef.current = true;
      router.replace(`${window.location.pathname}?competitors=${initial.ids.join(",")}`, { scroll: false });
    }
  }, [edited, urlIds, initial, ct, id, router]);

  // Capture mount timestamp once to avoid impure Date.now() in render path.
  const [mountMs] = useState(() => Date.now());
  const compareMode = analysisCompareMode(match, mountMs);

  // Compare query: fires for completed matches (coaching mode) and for live
  // matches whose organizer has enabled live scorecard access (or where our
  // bot has Staff bypass). When that flag is false during a live match, SSI
  // returns empty scorecards (#410) and we render the "Match in progress"
  // empty state instead. useCompareQuery self-disables on an empty id list.
  const liveScoresAccessible = match.is_live_scores_accessible === true;
  const compareEnabled = compareMode === "coaching" || liveScoresAccessible;
  const compareQuery = useCompareQuery(ct, id, compareEnabled ? selectedIds : EMPTY_IDS, compareMode);
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

  // Tracked-in-match indicator: how many tracked/identity shooters are in this match.
  const trackedInMatch = useMemo(() => {
    const map = new Map(
      match.competitors
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
  }, [match, trackedShooters, identity]);

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

  // Undo banner state — populated when a bulk action (clear, squad replace,
  // smart benchmark preset) overwrites the user's selection. Auto-clears
  // after UNDO_TIMEOUT_MS or on the next plain selection change.
  const UNDO_TIMEOUT_MS = 5000;
  const [pendingUndo, setPendingUndo] = useState<{
    prevIds: number[];
    message: string;
    expiresAt: number;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingUndo(null);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);


  const writeSelection = useCallback(
    (ids: number[]) => {
      saveCompetitorSelection(ct, id, ids);
      setEdited(true);
      const qs = ids.length > 0 ? `?competitors=${ids.join(",")}` : "";
      router.replace(`${window.location.pathname}${qs}`, { scroll: false });
    },
    [ct, id, router],
  );

  function handleSelectionChange(ids: number[]) {
    // Any plain selection change invalidates a pending undo.
    if (pendingUndo) clearPendingUndo();
    writeSelection(ids);
  }

  function replaceSelectionWithUndo(newIds: number[], message: string) {
    // Capture the snapshot via the live store, not closure, to avoid stale prev.
    const prev = getCompetitorSelectionSnapshot(ct, id);
    writeSelection(newIds);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingUndo({ prevIds: prev, message, expiresAt: Date.now() + UNDO_TIMEOUT_MS });
    undoTimerRef.current = setTimeout(() => {
      setPendingUndo(null);
      undoTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);
  }

  function applyUndo() {
    if (!pendingUndo) return;
    writeSelection(pendingUndo.prevIds);
    clearPendingUndo();
  }

  function moveCompetitor(id: number, direction: "left" | "right") {
    const idx = selectedIds.indexOf(id);
    if (idx === -1) return;
    const swapWith = direction === "left" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    handleSelectionChange(next);
  }

  // Resolve the identity's per-match competitor ID (null when not in this match).
  const myCompetitorId = identity?.shooterId != null
    ? (match.competitors.find((c) => c.shooterId === identity.shooterId)?.id ?? null)
    : null;

  // results_status === "all" is the definitive "published" signal from SSI.
  const isMatchComplete = match.results_status === "all" || compareMode === "coaching";
  const aiAvailable = coachingAvailability.data?.available === true;

  // Pick the cachedAt to show in the "Updated X ago" badge.
  //
  // During the **live** phase, prefer the dedicated `scorecardsCachedAt`
  // shipped by the compare route — that's the timestamp of the last
  // scorecards-key refetch, which after PR #392 is full-refetched on every
  // SWR cycle. The legacy `cacheInfo.cachedAt` reflects the match-overview
  // key, which uses the if-modified-since probe and drifts toward the 5-min
  // probe ceiling during scoring (event.updated doesn't tick on scorecard
  // saves). Surfacing the match-overview age made the badge read
  // "Updated 4 minutes ago" on a match whose scorecards data was actually
  // 20 seconds old (reported during SPSK Open 2026, match 22/27190).
  //
  // For prematch / finished phases the staler-of-two is still right:
  // match metadata changes (squadding, registration, results-published)
  // matter, and there's no scoring loop driving scorecards freshness.
  const matchCachedAt = match.cacheInfo.cachedAt;
  const compareCachedAt = compareQuery.data?.cacheInfo.cachedAt ?? null;
  const scorecardsCachedAt =
    compareQuery.data?.cacheInfo.scorecardsCachedAt ?? null;
  const isLivePhase = compareMode === "live";
  const stalestCachedAt = isLivePhase
    ? scorecardsCachedAt ?? compareCachedAt ?? matchCachedAt
    : matchCachedAt && compareCachedAt
      ? new Date(matchCachedAt) < new Date(compareCachedAt)
        ? matchCachedAt
        : compareCachedAt
      : matchCachedAt ?? compareCachedAt;

  // Either response can flag the upstream as degraded. Show the banner when
  // any active query reports it — disappears as soon as a fresh response lands.
  const upstreamDegraded =
    match.cacheInfo.upstreamDegraded === true ||
    compareQuery.data?.cacheInfo.upstreamDegraded === true;
  // Deliberate pause (SSI_UPSTREAM_PAUSED) — steadier than the 60s degraded
  // flag and switches the banner to honest "we paused" copy.
  const upstreamPaused =
    match.cacheInfo.upstreamPaused === true ||
    compareQuery.data?.cacheInfo.upstreamPaused === true;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <LoadingBar
        matchLoaded={true}
        compareLoaded={!!compareQuery.data}
        hasCompetitors={selectedIds.length > 0}
      />
      {/* Cache freshness + share */}
      <div className="flex items-center justify-end gap-3">
        <CacheInfoBadge
          ct={ct}
          id={id}
          cachedAt={stalestCachedAt}
          lastScorecardAt={compareQuery.data?.cacheInfo.lastScorecardAt ?? null}
          phase={compareMode === "coaching" ? "finished" : "live"}
          isRefreshing={isFetching || compareQuery.isFetching}
        />
        <ShareButton title={match.name} competitorCount={selectedIds.length} />
      </div>

      {/* Upstream degraded banner — shown when SSI is failing (or we've
          deliberately paused upstream traffic) and we're serving stale data */}
      {(upstreamDegraded || upstreamPaused) && (
        <UpstreamDegradedBanner cachedAt={stalestCachedAt} paused={upstreamPaused} />
      )}

      {/* Competitor picker */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium">Compare competitors</p>
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                aria-label="How competitor selection works"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80" side="bottom" align="start">
              <PopoverHeader>
                <PopoverTitle>Picking who to compare</PopoverTitle>
                <PopoverDescription>
                  Mix and match up to {MAX_COMPETITORS} competitors. Your favorites and &ldquo;you&rdquo; appear at the top of the picker.
                </PopoverDescription>
              </PopoverHeader>
              <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                <p><strong>Star</strong> — favorite a competitor. Stars live in the picker, in the comparison table header, and on the shooter dashboard. The picker also has an &ldquo;Add all favorites&rdquo; pill so you can pull in everyone you track in one tap.</p>
                <p><strong>Squad</strong> — replaces your selection with everyone in a squad. One tap to undo.</p>
                <p><strong>Benchmark</strong> — once you set &ldquo;this is me&rdquo; in My Shooters, you unlock one-tap presets: one-above, one-below, division podium, percentile cohort, and same-club peers.</p>
                <p><strong>Reorder</strong> — use the chevrons in each comparison-table column header to move a competitor left or right. Their column color follows the new position.</p>
                <p><strong>Clear</strong> — wipes the selection. Undo lasts 5 seconds.</p>
              </div>
            </PopoverContent>
          </Popover>
          {trackedInMatch && trackedInMatch.total > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">
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
              onReplaceSelection={(ids, squadName) =>
                replaceSelectionWithUndo(
                  ids,
                  `Replaced selection with ${squadName}`,
                )
              }
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
              myShooterId={identity?.shooterId ?? null}
              onReplaceSelection={(ids, message) =>
                replaceSelectionWithUndo(ids, message)
              }
              disabled={!compareQuery.data}
            />
          )}
          {selectedIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (selectedIds.length === 0) return;
                replaceSelectionWithUndo(
                  [],
                  `Cleared ${selectedIds.length} selected`,
                );
              }}
              aria-label="Clear all selected competitors"
            >
              <XCircle className="w-4 h-4" aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>
        {pendingUndo && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm animate-fade-in"
          >
            <span className="text-muted-foreground truncate">
              {pendingUndo.message}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={applyUndo}
              aria-label="Undo last selection change"
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              Undo
            </Button>
          </div>
        )}
      </div>

      {/* Match in progress -- shown when SSI/organizer has not enabled live
          scorecard access for this match. When the organizer flips "Resultat"
          to a public option (or our bot has Staff bypass), the comparison
          renders below in live mode instead. */}
      {compareMode === "live" && !match.is_live_scores_accessible && (
        <div
          role="status"
          className="rounded-lg border bg-muted/40 p-4 space-y-2"
        >
          <h2 className="font-semibold">Match in progress</h2>
          <p className="text-sm text-muted-foreground">
            The organizer has not made live scores public for this match.
            Detailed stage results will be available once scoring is complete
            {match.scoring_pct > 0
              ? ` (${Math.round(match.scoring_pct)}% scored so far)`
              : ""}
            .
          </p>
          {match.ssi_url && (
            <p className="text-sm">
              <a
                href={match.ssi_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80"
              >
                Follow live on ShootNScoreIt
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens in new tab)</span>
              </a>
            </p>
          )}
        </div>
      )}

      {/* Comparison views — rendered for completed matches (coaching mode)
          and for live matches whose organizer has enabled live scorecard access. */}
      {compareEnabled && selectedIds.length > 0 && (
        <div className="space-y-6">
          {compareMode === "live" &&
            match.is_live_scores_accessible &&
            match.results_status !== "all" && (
              <div
                role="status"
                className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              >
                Live scores published by the organizer. Final standings appear once the match completes.
              </div>
            )}
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

          {compareQuery.data?.scorecardsRestricted && (
            <div
              role="status"
              className="rounded-lg border bg-muted/40 p-4 space-y-2"
            >
              <h2 className="font-semibold">Per-stage scorecards not available</h2>
              <p className="text-sm text-muted-foreground">
                ShootNScoreIt does not publish per-stage scorecard data for Level I
                club matches. Official results are available on shootnscoreit.com.
              </p>
              {match.ssi_url && (
                <p className="text-sm">
                  <a
                    href={match.ssi_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2 hover:opacity-80"
                  >
                    Open on shootnscoreit.com
                  </a>
                </p>
              )}
            </div>
          )}

          {compareQuery.data && !compareQuery.data.scorecardsRestricted && (
            <>
              {/* Focus areas -- identity-gated; coaching mode only */}
              {compareMode === "coaching" &&
                myCompetitorId != null &&
                selectedIds.includes(myCompetitorId) && (() => {
                  const competitorName =
                    match.competitors.find((c) => c.id === myCompetitorId)?.name ?? "You";
                  const focusAreas = computeFocusAreas(compareQuery.data, myCompetitorId);
                  if (focusAreas.length === 0) return null;
                  return (
                    <FocusAreasSection
                      focusAreas={focusAreas}
                      competitorName={competitorName}
                    />
                  );
                })()}

              <div id="chart-stage-results" className="rounded-lg border p-4 space-y-3">
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
                  scoringCompleted={match.scoring_pct}
                  onRemove={(id) => handleSelectionChange(selectedIds.filter((s) => s !== id))}
                  aiAvailable={aiAvailable}
                  isComplete={isMatchComplete}
                  ct={ct}
                  matchId={id}
                  stageSort={stageSort}
                  onSortChange={setStageSort}
                  sortedStages={sortedStages}
                  trackedShooterIds={trackedIds}
                  onToggleTracked={handleToggleTracked}
                  onMove={moveCompetitor}
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
                <ComparisonChart
                  data={compareQuery.data}
                  stages={sortedStages}
                  careerBaselineHF={myCompetitorId != null ? careerBaseline?.medianHF : null}
                />
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
                <HfPercentChart
                  data={compareQuery.data}
                  stages={sortedStages}
                  careerBaselinePct={myCompetitorId != null ? careerBaseline?.medianMatchPct : null}
                />
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

              <div id="chart-speed-accuracy" className="rounded-lg border p-4 space-y-3">
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
              {compareMode === "coaching" && (
                <>
                  {/* Coaching / analysis view — hidden by default */}
                  <Collapsible id="coaching-analysis" open={showCoachingView} onOpenChange={onCoachingOpenChange} className="rounded-lg border p-4 space-y-3">
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

                        <StageTimesExport
                          ct={ct}
                          id={id}
                          match={match}
                          compareData={compareQuery.data}
                          selectedIds={selectedIds}
                        />
                      </section>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Stage Simulator — collapsed by default, only ≥ 80% complete */}
                  {match.scoring_pct >= 80 && (
                    <Collapsible open={showSimulator} onOpenChange={onSimulatorOpenChange} className="rounded-lg border p-4">
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
                            scoringCompleted={match.scoring_pct}
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

      {selectedIds.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Select one or more competitors above to see the comparison.
        </p>
      )}

      <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
    </div>
  );
}
