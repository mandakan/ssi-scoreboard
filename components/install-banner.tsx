"use client";

import { startTransition, useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { usePWAInstall } from "@/lib/pwa-install";

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallBanner() {
  const { canInstall, isIos, isInstalled, triggerInstall } = usePWAInstall();
  const [mounted, setMounted] = useState(false);
  // Always start false to match server render; update after hydration.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    startTransition(() => {
      setMounted(true);
      setDismissed(!!localStorage.getItem(DISMISSED_KEY));
    });
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    await triggerInstall();
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  // Don't render until mounted — server always returns null, client matches it.
  if (!mounted) return null;

  const showAndroid = canInstall && !isInstalled && !dismissed;
  const showIos = isIos && !isInstalled && !dismissed;

  if (!showAndroid && !showIos) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-14 md:bottom-0 inset-x-0 z-40 flex items-center justify-between gap-3 px-4 py-3 bg-primary text-primary-foreground text-sm shadow-lg"
    >
      {showAndroid && (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Install SSI Scoreboard for quick courtside access.</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void install()}
              className="px-3 py-1 rounded-full bg-primary-foreground/15 hover:bg-primary-foreground/25 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
            >
              Install
            </button>
            <button
              type="button"
              aria-label="Dismiss install prompt"
              onClick={dismiss}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] opacity-70 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {showIos && (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Share className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Tap the{" "}
              <Share
                className="inline w-3.5 h-3.5 align-text-bottom mx-0.5"
                aria-label="Share"
              />{" "}
              button, then <strong>Add to Home Screen</strong>.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss install instructions"
            onClick={dismiss}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] shrink-0 opacity-70 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
