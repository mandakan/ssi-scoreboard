"use client";

import { useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { useMatch } from "@/components/match-gate";
import { MatchHeader } from "@/components/match-header";
import { PreMatchView } from "@/components/pre-match-view";
import { ShareButton } from "@/components/share-button";
import { ShareEventLink } from "@/components/share-event-link";
import { TrackedShootersSheet } from "@/components/tracked-shooters-sheet";
import { UpstreamDegradedBanner } from "@/components/upstream-degraded-banner";
import { getCompetitorSelectionSnapshot } from "@/lib/competition-store";
import { useMyIdentity } from "@/lib/hooks/use-my-identity";
import { useTrackedShooters } from "@/lib/hooks/use-tracked-shooters";
import { useCoachingAvailability } from "@/lib/queries";

export default function InfoPageClient() {
  const { ct, id, match } = useMatch();
  const { identity } = useMyIdentity();
  const { trackedIds } = useTrackedShooters();
  const coachingAvailability = useCoachingAvailability();
  // Info does not edit the selection, so a one-time read is enough.
  const [selectedIds] = useState(() => getCompetitorSelectionSnapshot(ct, id));
  const [showManage, setShowManage] = useState(false);

  const resultsPublished = match.results_status === "all";
  const matchCancelled = match.match_status === "cs";
  const aiAvailable = coachingAvailability.data?.available === true;
  const upstreamDegraded = match.cacheInfo.upstreamDegraded === true;
  const upstreamPaused = match.cacheInfo.upstreamPaused === true;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2">
        <ShareEventLink ct={ct} id={id} matchName={match.name} />
        <ShareButton title={match.name} competitorCount={0} />
      </div>

      {/* Upstream degraded banner -- shown when SSI is failing (or we've
          deliberately paused upstream traffic) and we're serving stale data */}
      {(upstreamDegraded || upstreamPaused) && (
        <UpstreamDegradedBanner cachedAt={match.cacheInfo.cachedAt} paused={upstreamPaused} />
      )}

      <MatchHeader match={match} />

      {/* Results disclaimer -- shown whenever SSI has not publicly published results */}
      {!resultsPublished && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span>
            {matchCancelled
              ? "This match was cancelled."
              : "Results are not yet officially published by the organizers -- data shown here may change."
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

      <TrackedShootersSheet open={showManage} onOpenChange={setShowManage} />
    </div>
  );
}
