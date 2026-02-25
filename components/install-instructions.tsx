"use client";

import { CheckCircle, Download, Share, Monitor } from "lucide-react";
import { usePWAInstall } from "@/lib/pwa-install";

export function InstallInstructions() {
  const { canInstall, isIos, isInstalled, triggerInstall } = usePWAInstall();

  if (isInstalled) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-accent/30 text-sm text-muted-foreground">
        <CheckCircle className="w-5 h-5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
        <span>SSI Scoreboard is already installed on this device.</span>
      </div>
    );
  }

  if (canInstall) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your browser supports one-tap install — no app store needed.
        </p>
        <button
          type="button"
          onClick={() => void triggerInstall()}
          className="flex items-center gap-3 w-full p-4 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-left"
        >
          <Download className="w-5 h-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-sm">Install SSI Scoreboard</p>
            <p className="text-xs text-muted-foreground">
              Runs fullscreen, no browser chrome, fast to open
            </p>
          </div>
        </button>
      </div>
    );
  }

  if (isIos) {
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>To install on iOS:</p>
        <ol className="space-y-2 list-decimal list-inside leading-relaxed">
          <li>
            Open this page in <strong className="text-foreground">Safari</strong>
          </li>
          <li>
            Tap the{" "}
            <Share
              className="inline w-4 h-4 align-text-bottom mx-0.5"
              aria-label="Share"
            />{" "}
            <strong className="text-foreground">Share</strong> button in the
            toolbar
          </li>
          <li>
            Scroll down and tap{" "}
            <strong className="text-foreground">Add to Home Screen</strong>
          </li>
          <li>
            Tap <strong className="text-foreground">Add</strong> — done!
          </li>
        </ol>
        <p className="text-xs">
          The app will appear on your home screen and open fullscreen, just like
          a native app.
        </p>
      </div>
    );
  }

  // Desktop or browser without install prompt (Firefox, Safari desktop, etc.)
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <div className="flex items-start gap-3 p-4 rounded-lg border border-border">
        <Monitor className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Chrome or Edge (desktop)</p>
          <p>
            Look for the install icon{" "}
            <span aria-hidden="true">⊕</span> in the address bar, or open the
            browser menu and choose <strong className="text-foreground">Install SSI Scoreboard</strong>.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-4 rounded-lg border border-border">
        <Share className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">iPhone / iPad (Safari)</p>
          <p>
            Tap{" "}
            <Share
              className="inline w-3.5 h-3.5 align-text-bottom mx-0.5"
              aria-label="Share"
            />{" "}
            Share → <strong className="text-foreground">Add to Home Screen</strong>.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-4 rounded-lg border border-border">
        <Download className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Android (Chrome)</p>
          <p>
            Tap the browser menu → <strong className="text-foreground">Add to Home Screen</strong>{" "}
            or <strong className="text-foreground">Install app</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
