"use client";

import { AlertTriangle } from "lucide-react";

interface UpstreamDegradedBannerProps {
  /** ISO timestamp of the cached payload being shown (used for "X minutes ago"). */
  cachedAt: string | null;
}

// Single source for the wording so future i18n has one place to translate.
const COPY = {
  heading: "Live updates paused",
  // {age} is filled in below; if unknown, we drop the clause entirely.
  bodyWithAge: "ShootNScoreIt isn't responding. Showing the last scores we received {age}. We'll refresh as soon as it's back.",
  bodyWithoutAge: "ShootNScoreIt isn't responding. Showing the last scores we received before the outage. We'll refresh as soon as it's back.",
} as const;

function formatAge(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function UpstreamDegradedBanner({ cachedAt }: UpstreamDegradedBannerProps) {
  const body = cachedAt
    ? COPY.bodyWithAge.replace("{age}", formatAge(cachedAt))
    : COPY.bodyWithoutAge;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 sm:px-4 sm:py-3 flex items-start gap-2.5 text-sm"
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
          {body}
        </p>
      </div>
    </div>
  );
}
