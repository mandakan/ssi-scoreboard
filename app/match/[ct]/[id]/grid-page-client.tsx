"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { LiveGrid } from "@/components/live-grid";
import { SquadPicker } from "@/components/squad-picker";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { useMatch } from "@/components/match-gate";
import { Button } from "@/components/ui/button";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { resolveGridRows, type GridRowSource } from "@/lib/live-grid-rows";
import {
  SCORES_OPTIN_CHANGED,
  SELECTION_CHANGED,
  getCompetitorSelectionSnapshot,
  getGridSourcePreference,
  getLiveScoresOptIn,
  saveCompetitorSelection,
  saveGridSourcePreference,
  saveLiveScoresOptIn,
} from "@/lib/competition-store";
import { matchTabHref, resolveLegacyMatchUrl } from "@/lib/match-routes";
import { matchScoresPhase } from "@/lib/scores-phase";

// Stable reference for the useSyncExternalStore server snapshot.
const EMPTY_IDS: number[] = [];

const noopSubscribe = () => () => {};

function subscribeToMatchEvent(eventName: string, ct: string, id: string) {
  return (onChange: () => void) => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ ct: string; id: string }>;
      if (ev.detail?.ct === ct && ev.detail?.id === id) onChange();
    };
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  };
}

export default function GridPageClient() {
  const { ct, id, match } = useMatch();
  const router = useRouter();
  const { identity } = useMyIdentity();
  const { trackedIds } = useTrackedShooters();
  const [sourceOverride, setSourceOverride] = useState<GridRowSource | null>(null);
  const [showManage, setShowManage] = useState(false);
  // Captured once so the phase is stable across renders.
  const [mountMs] = useState(() => Date.now());

  // Hash never reaches the server, so #stage-N legacy links resolve here.
  // (?competitors= links are redirected earlier, in middleware.ts.)
  useEffect(() => {
    const target = resolveLegacyMatchUrl({ ct, id, search: "", hash: window.location.hash });
    if (target) router.replace(target);
  }, [ct, id, router]);

  // The remembered preference is read from storage (server snapshot "squad");
  // a click overrides it locally and is persisted for the next visit.
  const storedSource = useSyncExternalStore(
    noopSubscribe,
    useCallback(() => getGridSourcePreference(ct, id), [ct, id]),
    (): GridRowSource => "squad",
  );
  const source = sourceOverride ?? storedSource;

  const onSourceChange = (s: GridRowSource) => {
    setSourceOverride(s);
    saveGridSourcePreference(ct, id, s);
  };

  // The saved selection is the grid's last-resort row source, and the empty
  // state's squad pick writes it -- subscribe so the grid appears.
  const savedIds = useSyncExternalStore(
    useCallback(
      (onChange) => subscribeToMatchEvent(SELECTION_CHANGED, ct, id)(onChange),
      [ct, id],
    ),
    useCallback(() => getCompetitorSelectionSnapshot(ct, id), [ct, id]),
    () => EMPTY_IDS,
  );

  // Before scoring really starts nothing fetches scorecards on its own: the
  // user opts in per session (never an automatic upstream poll).
  const scoresOptIn = useSyncExternalStore(
    useCallback(
      (onChange) => subscribeToMatchEvent(SCORES_OPTIN_CHANGED, ct, id)(onChange),
      [ct, id],
    ),
    useCallback(() => getLiveScoresOptIn(ct, id), [ct, id]),
    () => false,
  );

  const rows = useMemo(
    () =>
      resolveGridRows({
        source,
        competitors: match.competitors,
        squads: match.squads,
        myShooterId: identity?.shooterId ?? null,
        trackedShooterIds: trackedIds,
        fallback: savedIds,
      }),
    [match, source, identity, trackedIds, savedIds],
  );

  const phase = matchScoresPhase(match, mountMs);

  if (!match.is_live_scores_accessible && phase !== "complete") {
    return (
      <div className="p-4">
        <div role="status" className="rounded-lg border bg-muted/40 p-4 space-y-2">
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
      </div>
    );
  }

  if (phase === "prematch" && !scoresOptIn) {
    return (
      <div className="p-4">
        <div role="status" className="rounded-lg border bg-muted/40 p-4 space-y-3">
          <h2 className="font-semibold">Scoring has not really started</h2>
          <p className="text-sm text-muted-foreground">
            Live scores are not loaded automatically this early in the match.
            Load them now if you want to see shooters who have already scored.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => saveLiveScoresOptIn(ct, id)}
            >
              Show live scores
            </Button>
            <Link
              href={matchTabHref(ct, id, "info")}
              className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2 hover:opacity-80"
            >
              Match info
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-4 space-y-3">
        <h2 className="text-base font-semibold">Pick your squad</h2>
        <p className="text-sm text-muted-foreground">
          Choose a squad to follow, or set yourself and the shooters you track
          in My shooters.
        </p>
        <div className="flex flex-wrap gap-2">
          {match.squads.length > 0 && (
            <SquadPicker
              squads={match.squads}
              selectedIds={[]}
              onReplaceSelection={(ids) => {
                // Following a squad = a saved selection the grid falls back to.
                saveCompetitorSelection(ct, id, ids);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => setShowManage(true)}
            className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm"
          >
            My shooters
          </button>
        </div>
        <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
      </div>
    );
  }

  return (
    <div className="h-full">
      <LiveGrid
        ct={ct}
        id={id}
        shooters={rows}
        myShooterId={identity?.shooterId ?? null}
        source={source}
        onSourceChange={onSourceChange}
      />
    </div>
  );
}
