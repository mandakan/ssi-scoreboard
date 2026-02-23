"use client";

import { useState } from "react";
import { RefreshCw, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
}

function formatTimeAgo(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function CacheInfoBadge({ ct, id, cachedAt }: CacheInfoBadgeProps) {
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

  const label = cachedAt ? `Updated ${formatTimeAgo(cachedAt)}` : "Live";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
        aria-label={`Cache status: ${label}. Click to manage cache.`}
      >
        <Clock className="w-3 h-3" aria-hidden="true" />
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
