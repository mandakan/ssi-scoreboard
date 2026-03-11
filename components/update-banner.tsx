"use client";

import { useState, useEffect } from "react";
import { RefreshCw, X } from "lucide-react";

const POLL_INTERVAL_MS = 60_000;

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const clientBuildId = process.env.NEXT_PUBLIC_BUILD_ID;
    // No build ID means local dev — skip entirely.
    if (!clientBuildId) return;

    async function checkVersion() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildId } = (await res.json()) as { buildId: string | null };
        if (buildId && buildId !== clientBuildId) {
          setUpdateAvailable(true);
        }
      } catch {
        // Network error — silently ignore, try again next interval.
      }
    }

    const id = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-14 md:bottom-0 inset-x-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-primary text-primary-foreground text-sm shadow-lg"
    >
      <div className="flex items-center gap-2">
        <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>A new version is available.</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-3 py-1 rounded-full bg-primary-foreground/15 hover:bg-primary-foreground/25 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
        >
          Refresh
        </button>
        <button
          type="button"
          aria-label="Dismiss update notification"
          onClick={() => setUpdateAvailable(false)}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] opacity-70 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
