"use client";

import { AlertTriangle } from "lucide-react";
import { useUpstreamStatusQuery } from "@/lib/queries";

const COPY = {
  heading: "ShootNScoreIt is having trouble",
  body: "Match data comes from shootnscoreit.com, which isn't responding right now. Search and the live list may be empty or out of date until it's back. This isn't a problem with the scoreboard.",
} as const;

/**
 * Homepage banner that appears when the upstream SSI GraphQL API has failed
 * within the last ~60s. Polls /api/upstream-status every 30s. Self-hides when
 * the flag clears (TTL expires server-side).
 *
 * Renders nothing in the healthy case so it never adds vertical space to the
 * homepage outside of an actual outage.
 */
export function UpstreamStatusBanner() {
  const { data } = useUpstreamStatusQuery();
  if (!data?.degraded) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full max-w-2xl rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 sm:px-4 sm:py-3 flex items-start gap-2.5 text-sm"
    >
      <AlertTriangle
        className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-900 dark:text-amber-200 leading-tight">
          {COPY.heading}
        </p>
        <p className="text-amber-900/90 dark:text-amber-100/90 mt-0.5 leading-snug">
          {COPY.body}
        </p>
      </div>
    </div>
  );
}
