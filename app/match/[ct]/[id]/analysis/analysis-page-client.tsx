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
import { MatchTabPlaceholder } from "@/components/match-tab-placeholder";
import { useCompareQuery, useCoachingAvailability, useShooterDashboardQuery } from "@/lib/queries";
import { computeCareerBaseline } from "@/lib/career-baseline";
import { matchScoresPhase } from "@/lib/scores-phase";
import { analysisCompareMode, initialAnalysisSelection } from "@/lib/analysis-selection";
import { CacheInfoBadge } from "@/components/cache-info-badge";
import { UpstreamDegradedBanner } from "@/components/upstream-degraded-banner";
import { LoadingBar } from "@/components/loading-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, AlertCircle, RefreshCw, HelpCircle, ExternalLink, Undo2, XCircle } from "lucide-react";
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
  getLiveScoresOptIn,
  saveLiveScoresOptIn,
  SCORES_OPTIN_CHANGED,
  SELECTION_CHANGED,
} from "@/lib/competition-store";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { MAX_COMPETITORS } from "@/lib/constants";
import { resolveGridRows, type GridRowSource } from "@/lib/live-grid-rows";
import { DeepDive } from "@/components/analysis/deep-dive";
import { computeFocusAreas } from "@/lib/coaching-rules";
import { ChartsCard } from "@/components/analysis/charts-card";

const noopSubscribeGridSource = () => () => {};

// Stable empty array for useSyncExternalStore server snapshot — must be a
// constant reference so React's referential equality check doesn't loop.
const EMPTY_IDS: number[] = [];

const FocusAreasSection = dynamic(
  () =>
    import("@/components/focus-areas-section").then(
      (m) => m.FocusAreasSection,
    ),
  { ssr: false },
);

/**
 * Server render and hydration show a neutral placeholder: the selection is
 * seeded from browser-only state (saved selection, identity, tracked
 * shooters) and the phase from Date.now(), so the server would otherwise
 * render the empty picker state and flip on the client.
 */
export default function AnalysisPageClient() {
  const hydrated = useHydrated();
  if (!hydrated) return <MatchTabPlaceholder />;
  return <AnalysisPageContent />;
}

function AnalysisPageContent() {
  const { ct, id, match, isFetching } = useMatch();

  const [showManage, setShowManage] = useState(false);

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
  // Stored source read via useSyncExternalStore (server snapshot "squad") so
  // SSR and hydration agree.
  const gridSource = useSyncExternalStore(
    noopSubscribeGridSource,
    useCallback(() => getGridSourcePreference(ct, id), [ct, id]),
    (): GridRowSource => "squad",
  );
  const gridRows = useMemo(
    () =>
      resolveGridRows({
        source: gridSource,
        competitors: match.competitors,
        squads: match.squads,
        myShooterId: identity?.shooterId ?? null,
        trackedShooterIds: trackedIds,
        fallback: EMPTY_IDS,
      }),
    [gridSource, match, identity, trackedIds],
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

  // Selection: an explicit URL wins, then the saved selection, then the
  // grid's rows (see initialAnalysisSelection). Derived at render rather than
  // copied into state. A seed is never persisted or written to the URL:
  // that would pin the next visit (and the grid's fallback) to a list the
  // user never chose. Once the user edits, the saved selection is the source
  // of truth, so Clear does not re-seed.
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
  const selectedIds = edited
    ? urlIds.length > 0 ? urlIds : savedIds
    : initial.ids.length > 0 ? initial.ids : EMPTY_IDS;

  // Arrival sync, once per visit: persist a shared-link selection, or reflect
  // an already-saved selection into the URL.
  const arrivalHandledRef = useRef(false);
  useEffect(() => {
    if (arrivalHandledRef.current) return;
    if (urlIds.length > 0) {
      arrivalHandledRef.current = true;
      saveCompetitorSelection(ct, id, urlIds);
    } else if (savedIds.length > 0) {
      arrivalHandledRef.current = true;
      router.replace(`${window.location.pathname}?competitors=${savedIds.join(",")}`, { scroll: false });
    }
  }, [urlIds, savedIds, ct, id, router]);

  // Capture mount timestamp once to avoid impure Date.now() in render path.
  // Client-only: this component mounts after hydration (see AnalysisPageClient).
  const [mountMs] = useState(() => Date.now());
  const compareMode = analysisCompareMode(match, mountMs);
  const phase = matchScoresPhase(match, mountMs);
  // Before scoring really starts nothing fetches scorecards on its own: the
  // user opts in per session (never an automatic upstream poll).
  const scoresOptIn = useSyncExternalStore(
    useCallback(
      (onChange) => {
        window.addEventListener(SCORES_OPTIN_CHANGED, onChange);
        return () => window.removeEventListener(SCORES_OPTIN_CHANGED, onChange);
      },
      [],
    ),
    useCallback(() => getLiveScoresOptIn(ct, id), [ct, id]),
    () => false,
  );
  const prematchGated = phase === "prematch" && !scoresOptIn;

  // Compare query: fires for completed matches (coaching mode) and for live
  // matches whose organizer has enabled live scorecard access (or where our
  // bot has Staff bypass). When that flag is false during a live match, SSI
  // returns empty scorecards (#410) and we render the "Match in progress"
  // empty state instead. useCompareQuery self-disables on an empty id list.
  const liveScoresAccessible = match.is_live_scores_accessible === true;
  const compareEnabled =
    (compareMode === "coaching" || liveScoresAccessible) && !prematchGated;
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
    // What the user sees now, which is not in the store while it is seeded.
    const prev = selectedIds;
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
            <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" side="bottom" align="start">
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

      {/* Pre-match gate: scorecards are not loaded until the user asks. */}
      {prematchGated && liveScoresAccessible && (
        <div role="status" className="rounded-lg border bg-muted/40 p-4 space-y-2">
          <h2 className="font-semibold">Scoring has not really started</h2>
          <p className="text-sm text-muted-foreground">
            Live scores are not loaded automatically this early in the match.
            Load them now if you want to compare shooters who have already scored.
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => saveLiveScoresOptIn(ct, id)}
          >
            Show live scores
          </Button>
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

              <ChartsCard
                data={compareQuery.data}
                stages={sortedStages}
                sortedCompName={sortedCompName}
                careerBaselineHF={myCompetitorId != null ? careerBaseline?.medianHF : null}
                careerBaselinePct={myCompetitorId != null ? careerBaseline?.medianMatchPct : null}
                ct={ct}
              />

              <DeepDive
                ct={ct}
                id={id}
                match={match}
                selectedIds={selectedIds}
                compareMode={compareMode}
                coachingData={compareMode === "coaching" ? compareQuery.data : undefined}
              />
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
