"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  Users,
  Clock,
  LayoutList,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { importSyncPayload, getSyncStats } from "@/lib/sync";
import type { SyncPayload, SyncStats } from "@/lib/types";
import { SYNC_CODE_LENGTH, SYNC_CODE_CHARSET } from "@/lib/sync";

type SyncState =
  | { step: "input" }
  | { step: "loading" }
  | { step: "preview"; payload: SyncPayload; stats: SyncStats }
  | { step: "success" }
  | { step: "error"; message: string };

const VALID_CODE_REGEX = new RegExp(
  `^[${SYNC_CODE_CHARSET}]{${SYNC_CODE_LENGTH}}$`,
);

/** Parse an initial code from URL search params (QR flow). */
function getInitialCode(params: URLSearchParams): string | null {
  const raw = params.get("code");
  if (!raw) return null;
  const normalized = raw.toUpperCase().trim();
  return VALID_CODE_REGEX.test(normalized) ? normalized : null;
}

export function SyncPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialCode = getInitialCode(searchParams);

  const [state, setState] = useState<SyncState>(
    initialCode ? { step: "loading" } : { step: "input" },
  );
  const [code, setCode] = useState(initialCode ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFetched = useRef(false);

  const fetchSyncData = useCallback(
    async (syncCode: string) => {
      setState({ step: "loading" });

      try {
        const res = await fetch(`/api/sync/${encodeURIComponent(syncCode)}`);

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const message =
            res.status === 404
              ? "Code not found or expired. Please generate a new code on your other device."
              : (body as { error?: string })?.error ?? "Something went wrong";
          setState({ step: "error", message });
          return;
        }

        const payload = (await res.json()) as SyncPayload;
        const stats = getSyncStats(payload);
        setState({ step: "preview", payload, stats });
      } catch {
        setState({
          step: "error",
          message: "Network error. Please check your connection and try again.",
        });
      }
    },
    [],
  );

  // Auto-submit for QR code flow: start fetch on mount when URL has a valid code.
  // Uses a callback ref on a hidden element to avoid setState-in-effect lint rule.
  const mountRef = useCallback(
    (node: HTMLElement | null) => {
      if (node && initialCode && !hasFetched.current) {
        hasFetched.current = true;
        void fetchSyncData(initialCode);
      }
    },
    [initialCode, fetchSyncData],
  );

  // Auto-focus the input
  useEffect(() => {
    if (state.step === "input") {
      inputRef.current?.focus();
    }
  }, [state.step]);

  function handleCodeChange(value: string) {
    // Filter to allowed chars and uppercase
    const filtered = value
      .toUpperCase()
      .split("")
      .filter((ch) => SYNC_CODE_CHARSET.includes(ch))
      .join("")
      .slice(0, SYNC_CODE_LENGTH);
    setCode(filtered);

    // Auto-submit when all chars entered
    if (filtered.length === SYNC_CODE_LENGTH && VALID_CODE_REGEX.test(filtered)) {
      fetchSyncData(filtered);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.toUpperCase().trim();
    if (VALID_CODE_REGEX.test(normalized)) {
      fetchSyncData(normalized);
    }
  }

  function handleImport(payload: SyncPayload) {
    importSyncPayload(payload);
    setState({ step: "success" });
  }

  function handleReset() {
    setCode("");
    hasFetched.current = false;
    setState({ step: "input" });
  }

  return (
    <main ref={mountRef} className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* ── Input step ── */}
        {state.step === "input" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold">Sync from another device</h1>
              <p className="text-sm text-muted-foreground" id="sync-help">
                Enter the 6-character code shown on your other device.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <label htmlFor="sync-code-input" className="sr-only">
                Sync code
              </label>
              <input
                ref={inputRef}
                id="sync-code-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={SYNC_CODE_LENGTH}
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                aria-describedby="sync-help"
                placeholder="------"
                className="w-full rounded-lg border bg-background px-4 py-3 text-center text-2xl font-mono font-bold tracking-[0.3em] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="submit"
                className="w-full"
                disabled={code.length !== SYNC_CODE_LENGTH}
              >
                Import settings
              </Button>
            </form>

            <div className="space-y-3 text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to home
              </Link>
              <p className="text-xs text-muted-foreground">
                Don&apos;t have a code? Open &quot;My shooters&quot; on your
                other device and tap &quot;Generate sync code&quot;.
              </p>
            </div>
          </>
        )}

        {/* ── Loading step ── */}
        {state.step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-8" aria-live="polite">
            <Loader2
              className="h-8 w-8 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              Retrieving settings...
            </p>
          </div>
        )}

        {/* ── Preview step ── */}
        {state.step === "preview" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold">Import preview</h1>
              <p className="text-sm text-muted-foreground">
                The following settings will be imported to this device.
              </p>
            </div>

            <div className="space-y-2" role="list" aria-label="Settings to import">
              <PreviewItem
                icon={<User className="h-4 w-4" aria-hidden="true" />}
                label="Identity"
                value={
                  state.payload.identity
                    ? state.payload.identity.name
                    : "Not set"
                }
              />
              <PreviewItem
                icon={<Users className="h-4 w-4" aria-hidden="true" />}
                label="Tracked shooters"
                value={
                  state.stats.trackedCount > 0
                    ? `${state.stats.trackedCount} shooter${state.stats.trackedCount !== 1 ? "s" : ""}`
                    : "None"
                }
                detail={
                  state.stats.trackedCount > 0
                    ? state.payload.tracked.map((t) => t.name).join(", ")
                    : undefined
                }
              />
              <PreviewItem
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                label="Recent matches"
                value={
                  state.stats.recentCount > 0
                    ? `${state.stats.recentCount} match${state.stats.recentCount !== 1 ? "es" : ""}`
                    : "None"
                }
              />
              <PreviewItem
                icon={<LayoutList className="h-4 w-4" aria-hidden="true" />}
                label="Saved selections"
                value={
                  state.stats.selectionsCount > 0
                    ? `${state.stats.selectionsCount} match${state.stats.selectionsCount !== 1 ? "es" : ""}`
                    : "None"
                }
              />
            </div>

            <p
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-foreground"
              role="alert"
            >
              This will replace your current settings on this device.
            </p>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleImport(state.payload)}
                className="flex-1"
              >
                Import
              </Button>
            </div>
          </>
        )}

        {/* ── Success step ── */}
        {state.step === "success" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CheckCircle2
              className="h-12 w-12 text-green-500"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h1 className="text-xl font-bold">Settings imported</h1>
              <p className="text-sm text-muted-foreground">
                Your tracked shooters and preferences are now on this device.
              </p>
            </div>
            <Button onClick={() => router.push("/")} className="mt-2">
              Go to home
            </Button>
          </div>
        )}

        {/* ── Error step ── */}
        {state.step === "error" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <AlertCircle
              className="h-12 w-12 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm" role="alert">
              {state.message}
            </p>
            <Button variant="outline" onClick={handleReset}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

// ── Preview item ─────────────────────────────────────────────────────────────

interface PreviewItemProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: string;
}

function PreviewItem({ icon, label, value, detail }: PreviewItemProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
      role="listitem"
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm font-medium">{value}</p>
        {detail && (
          <p className="text-xs text-muted-foreground truncate">{detail}</p>
        )}
      </div>
    </div>
  );
}
