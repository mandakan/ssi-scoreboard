"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Clock, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CacheInfoBadgeProps {
  ct: string;
  id: string;
  /** The most-stale cachedAt timestamp from match + compare responses (null = freshly fetched) */
  cachedAt: string | null;
  /** Most recent scorecard timestamp the upstream knows about (max scorecards.created).
   *  When this is much older than `cachedAt`, the cache is fresh but upstream itself
   *  is stale — useful signal that RO submissions may be backed up. */
  lastScorecardAt?: string | null;
  /** True if the SSI match is still in scoring (status not "cp"/"cs"). Drives
   *  the prominent stale-data warning — a 5-minute-old cache on a finished
   *  match is fine, but on an ongoing match it deserves attention. */
  matchOngoing?: boolean;
}

/** When the match is ongoing, escalate the badge styling once the cache age
 *  passes these thresholds. Default poll cadence is 30s, so anything past a
 *  few minutes is a sign that polling has stopped or upstream is not responding. */
const STALE_WARNING_SECONDS = 3 * 60; // amber: cache is older than expected
const STALE_ALERT_SECONDS = 10 * 60; // red: clearly stuck

function formatTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Tick the component every 15s so the "5m ago" / "1h ago" label
 *  re-renders without waiting for a real query refresh. */
function useTickingNow(intervalMs: number = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(handle);
  }, [intervalMs]);
  return now;
}

export function CacheInfoBadge({
  ct,
  id,
  cachedAt,
  lastScorecardAt,
  matchOngoing,
}: CacheInfoBadgeProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const queryClient = useQueryClient();

  async function handleForceRefresh() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch(
        `/api/admin/cache/purge?ct=${ct}&id=${id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${password}` },
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStatus("success");
      // Invalidate both queries so they re-fetch fresh data
      await queryClient.invalidateQueries({ queryKey: ["match", ct, id] });
      await queryClient.invalidateQueries({ queryKey: ["compare", ct, id] });
      setOpen(false);
      setPassword("");
      setStatus("idle");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  const now = useTickingNow();
  const cacheAgeSeconds = cachedAt
    ? Math.max(0, Math.floor((now - new Date(cachedAt).getTime()) / 1000))
    : 0;
  const isAlert = matchOngoing && cachedAt && cacheAgeSeconds > STALE_ALERT_SECONDS;
  const isWarning =
    !isAlert && matchOngoing && cachedAt && cacheAgeSeconds > STALE_WARNING_SECONDS;

  const label = cachedAt ? `Updated ${formatTimeAgo(cachedAt)}` : "Live";
  const buttonClass = cn(
    "inline-flex items-center gap-1 text-xs transition-colors rounded px-1.5 py-0.5",
    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
    isAlert
      ? "bg-destructive/15 text-destructive border border-destructive/40 font-medium hover:bg-destructive/25"
      : isWarning
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 hover:bg-amber-500/25"
        : "text-muted-foreground hover:text-foreground",
  );
  const ariaLabel = isAlert
    ? `Live updates appear paused — last sync ${label.toLowerCase()}. Click to manage cache.`
    : isWarning
      ? `Last sync ${label.toLowerCase()} — slower than usual. Click to manage cache.`
      : `Cache status: ${label}. Click to manage cache.`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass}
        aria-label={ariaLabel}
      >
        {isAlert || isWarning ? (
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        ) : (
          <Clock className="w-3 h-3" aria-hidden="true" />
        )}
        <span>{label}</span>
        <RefreshCw className="w-3 h-3" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setPassword(""); setStatus("idle"); setErrorMsg(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cache status</DialogTitle>
            <DialogDescription>
              {cachedAt
                ? `Data was cached at ${new Date(cachedAt).toLocaleString()}.`
                : "Data was just fetched fresh."}
              {lastScorecardAt ? (
                <>
                  <br />
                  Most recent scorecard upstream: {new Date(lastScorecardAt).toLocaleString()}
                  {" "}({formatTimeAgo(lastScorecardAt)}).
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4 pt-2"
            onSubmit={(e) => { e.preventDefault(); if (password) handleForceRefresh(); }}
          >
            <p className="text-sm text-muted-foreground">
              Enter the admin secret to force a cache refresh. The next page load will
              re-fetch from shootnscoreit.com.
            </p>

            <div className="space-y-1.5">
              <label htmlFor="purge-secret" className="text-sm font-medium">Admin secret</label>
              <Input
                id="purge-secret"
                type="password"
                placeholder="CACHE_PURGE_SECRET"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </div>

            {status === "error" && (
              <p role="alert" className="text-sm text-destructive">{errorMsg}</p>
            )}

            <Button
              type="submit"
              disabled={!password || status === "loading"}
              className="w-full"
            >
              {status === "loading" ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Purging…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                  Force refresh
                </>
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
