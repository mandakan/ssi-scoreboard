"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  User,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  HelpCircle,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  Check,
  Plus,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useShooterDashboardQuery } from "@/lib/queries";
import { triggerBackfill, addMatchToShooter } from "@/lib/api";
import type { ShooterMatchSummary, ShooterDashboardResponse, BackfillProgress } from "@/lib/types";

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatHF(hf: number | null): string {
  if (hf == null) return "—";
  return hf.toFixed(2);
}

function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}

function levelBadge(level: string | null): string {
  if (!level) return "";
  const m = level.match(/(\d+)/);
  return m ? `L${m[1]}` : level.slice(0, 3);
}

// ─── Trend indicator ──────────────────────────────────────────────────────────

function TrendIndicator({ slope }: { slope: number | null }) {
  if (slope == null) return null;
  const threshold = 0.001;
  if (slope > threshold) {
    return (
      <span
        className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-sm font-medium"
        aria-label="Improving trend"
      >
        <TrendingUp className="w-4 h-4" aria-hidden="true" />
        Improving
      </span>
    );
  }
  if (slope < -threshold) {
    return (
      <span
        className="inline-flex items-center gap-1 text-orange-500 text-sm font-medium"
        aria-label="Declining trend"
      >
        <TrendingDown className="w-4 h-4" aria-hidden="true" />
        Declining
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground text-sm"
      aria-label="Stable trend"
    >
      <Minus className="w-4 h-4" aria-hidden="true" />
      Stable
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-muted/40 rounded-lg px-3 py-2.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium leading-tight">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums leading-tight">
        {value}
      </span>
      {sub && (
        <span className="text-[11px] text-muted-foreground leading-tight">
          {sub}
        </span>
      )}
    </div>
  );
}

// ─── Match history card ───────────────────────────────────────────────────────

function MatchCard({ match }: { match: ShooterMatchSummary }) {
  const href = `/match/${match.ct}/${match.matchId}?competitors=${match.competitorId}`;
  const badge = levelBadge(match.level);

  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group min-h-[44px]"
      aria-label={`${match.name}${match.date ? `, ${formatDate(match.date)}` : ""}${match.matchPct != null ? `, ${formatPct(match.matchPct)} match score` : ""}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{match.name}</span>
          {badge && (
            <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">
              {badge}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {formatDate(match.date)}
          </span>
          {match.division && (
            <span className="text-xs text-muted-foreground">
              · {match.division}
            </span>
          )}
          {match.stageCount > 0 && (
            <span className="text-xs text-muted-foreground">
              · {match.stageCount} stages
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">
        {match.matchPct != null && (
          <span className="text-sm font-semibold tabular-nums">
            {formatPct(match.matchPct)}
          </span>
        )}
        {match.avgHF != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatHF(match.avgHF)} HF
          </span>
        )}
      </div>
      <ChevronRight
        className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors"
        aria-hidden="true"
      />
    </Link>
  );
}

// ─── Trend chart ──────────────────────────────────────────────────────────────

function TrendChart({ data }: { data: ShooterDashboardResponse }) {
  // Build chart data sorted oldest → newest (reverse of matches array)
  const chartData = useMemo(() => {
    return data.matches
      .slice()
      .reverse()
      .filter((m) => m.avgHF != null || m.matchPct != null)
      .map((m) => ({
        label: formatDateShort(m.date),
        avgHF: m.avgHF != null ? parseFloat(m.avgHF.toFixed(2)) : null,
        matchPct: m.matchPct != null ? parseFloat(m.matchPct.toFixed(1)) : null,
      }));
  }, [data.matches]);

  const hasHF = chartData.some((d) => d.avgHF != null);
  const hasPct = chartData.some((d) => d.matchPct != null);

  if (chartData.length < 2) return null;

  return (
    <div className="flex flex-col gap-4">
      {hasHF && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <h3 className="text-sm font-medium">Hit factor over time</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="About the hit factor trend chart"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
                <p className="font-medium">Hit factor over time</p>
                <p className="text-muted-foreground">
                  Each point is the average hit factor across all valid stages in
                  a match. Higher is better — it reflects speed and accuracy
                  combined.
                </p>
                <p className="text-muted-foreground">
                  A rising trend means you&apos;re shooting faster or more
                  accurately (or both) across competitions. Compare this with the
                  match % chart to separate absolute improvement from field
                  quality.
                </p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="h-48" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    color: "var(--popover-foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.375rem",
                    fontSize: 12,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
                  }}
                  labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--popover-foreground)" }}
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                  formatter={(value: number | undefined) => [value != null ? value.toFixed(2) : "—", "Avg HF"]}
                />
                <Line
                  type="monotone"
                  dataKey="avgHF"
                  name="Avg HF"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--chart-1)" }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasPct && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <h3 className="text-sm font-medium">Match % over time</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="About the match percentage trend chart"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
                <p className="font-medium">Match % over time</p>
                <p className="text-muted-foreground">
                  Each point is your average division % across all stages in a
                  match — how close you ran to the division winner on each stage,
                  averaged across the whole match.
                </p>
                <p className="text-muted-foreground">
                  This normalises for match difficulty. A consistent 75% at
                  different level competitions means you&apos;re keeping pace
                  with your division across varying field strengths.
                </p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="h-48" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  domain={[0, 100]}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    color: "var(--popover-foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: "0.375rem",
                    fontSize: 12,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
                  }}
                  labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--popover-foreground)" }}
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                  formatter={(value: number | undefined) => [value != null ? `${value.toFixed(1)}%` : "—", "Match %"]}
                />
                <Line
                  type="monotone"
                  dataKey="matchPct"
                  name="Match %"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--chart-2)" }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Backfill section ────────────────────────────────────────────────────────

function BackfillSection({ shooterId }: { shooterId: number }) {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<BackfillProgress | null>(null);

  const mutation = useMutation({
    mutationFn: () => triggerBackfill(shooterId),
    onSuccess: (data) => {
      setLastResult(data);
      if (data.discovered > 0) {
        queryClient.invalidateQueries({ queryKey: ["shooter-dashboard", shooterId] });
      }
    },
  });

  const isRunning = mutation.isPending;
  const isDone = lastResult?.status === "complete" && !isRunning;

  return (
    <div className="rounded-lg border border-border p-3">
      {!isRunning && !isDone && (
        <button
          type="button"
          onClick={() => mutation.mutate()}
          className="flex items-center gap-2 w-full text-left min-h-[2.75rem]"
          aria-label="Scan cached matches to find your past competitions"
        >
          <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">Find past matches</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Scans cached data to find competitions you entered.
            </p>
          </div>
        </button>
      )}

      {isRunning && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium">Scanning cached matches…</span>
          </div>
        </div>
      )}

      {isDone && lastResult && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium">
              {lastResult.discovered > 0
                ? `Found ${lastResult.discovered} new match${lastResult.discovered !== 1 ? "es" : ""}`
                : "No new matches found"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {lastResult.totalCached} cached match{lastResult.totalCached !== 1 ? "es" : ""} scanned
            {lastResult.alreadyIndexed > 0 && ` · ${lastResult.alreadyIndexed} already indexed`}
          </p>
          {lastResult.errorMessage && (
            <p className="text-xs text-muted-foreground">{lastResult.errorMessage}</p>
          )}
          <button
            type="button"
            onClick={() => { setLastResult(null); mutation.mutate(); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors self-start min-h-[2.75rem] flex items-center"
          >
            Scan again
          </button>
        </div>
      )}

      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive mt-1">
          {mutation.error instanceof Error ? mutation.error.message : "Scan failed"}
        </p>
      )}
    </div>
  );
}

// ─── Add match by URL section ───────────────────────────────────────────────

function AddMatchSection({ shooterId }: { shooterId: number }) {
  const queryClient = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (url: string) => addMatchToShooter(shooterId, url),
    onSuccess: (data) => {
      if (data.success) {
        setUrlInput("");
        queryClient.invalidateQueries({ queryKey: ["shooter-dashboard", shooterId] });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    mutation.mutate(trimmed);
  };

  return (
    <div>
      <h3 className="text-sm font-semibold m-0 leading-none">
        <button
          type="button"
          id="add-match-heading"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="add-match-panel"
          className="flex w-full items-center gap-2 text-left min-h-[2.75rem]"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          )}
          <span className="text-muted-foreground uppercase tracking-wide text-xs">
            Add match by URL
          </span>
        </button>
      </h3>

      {open && (
        <section
          id="add-match-panel"
          role="region"
          aria-labelledby="add-match-heading"
          className="mt-1"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <label htmlFor="match-url-input" className="sr-only">
              Match URL
            </label>
            <input
              id="match-url-input"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://shootnscoreit.com/event/22/…"
              aria-describedby="match-url-help"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[2.75rem]"
              disabled={mutation.isPending}
            />
            <p id="match-url-help" className="text-xs text-muted-foreground">
              Paste a ShootNScoreIt match URL to add it to your history.
            </p>
            <button
              type="submit"
              disabled={!urlInput.trim() || mutation.isPending}
              className="self-start flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 min-h-[2.75rem] hover:bg-primary/90 transition-colors"
            >
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="w-4 h-4" aria-hidden="true" />
              )}
              Add match
            </button>
          </form>

          {mutation.isSuccess && (
            <p
              role="status"
              aria-live="polite"
              className={`text-sm mt-2 ${mutation.data.success ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
            >
              {mutation.data.message}
            </p>
          )}

          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive mt-2">
              {mutation.error instanceof Error ? mutation.error.message : "Failed to add match"}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

interface Props {
  shooterId: number | null;
}

export function ShooterDashboardClient({ shooterId }: Props) {
  const { data, isLoading, isError, error } = useShooterDashboardQuery(
    shooterId,
  );
  const [historyOpen, setHistoryOpen] = useState(true);

  if (shooterId == null) {
    return (
      <main className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <p role="alert" className="text-muted-foreground">
          Invalid shooter ID.
        </p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="flex flex-col items-center justify-center min-h-[60vh] px-4 gap-3">
        <Loader2
          className="w-6 h-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-muted-foreground text-sm">Loading stats…</p>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="flex flex-col items-center justify-center min-h-[60vh] px-4 gap-3">
        <AlertCircle className="w-6 h-6 text-destructive" aria-hidden="true" />
        <p role="alert" className="text-sm text-center">
          {error instanceof Error && error.message.includes("404")
            ? "No match history found. Visit a match you competed in to start building your stats."
            : "Could not load shooter stats. Please try again later."}
        </p>
      </main>
    );
  }

  const { profile, matchCount, matches, stats } = data;
  const displayName = profile?.name ?? `Shooter #${shooterId}`;
  const hasChartData =
    matches.filter((m) => m.avgHF != null || m.matchPct != null).length >= 2;

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* ── Identity card ─────────────────────────────────────────────── */}
      <section
        aria-labelledby="identity-heading"
        className="flex items-start gap-4 bg-muted/30 rounded-xl p-4 border border-border"
      >
        <div
          className="shrink-0 w-12 h-12 rounded-full bg-muted flex items-center justify-center"
          aria-hidden="true"
        >
          <User className="w-6 h-6 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h1
            id="identity-heading"
            className="text-lg font-bold leading-tight truncate"
          >
            {displayName}
          </h1>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-sm text-muted-foreground">
            {profile?.club && <span>{profile.club}</span>}
            {profile?.division && <span>{profile.division}</span>}
          </div>
          <div className="flex gap-4 mt-3">
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {matchCount}
              </div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Matches
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums">
                {stats.totalStages}
              </div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Stages
              </div>
            </div>
            {stats.dateRange.from && (
              <div>
                <div className="text-sm font-medium tabular-nums">
                  {formatDate(stats.dateRange.from)}
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  First match
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Aggregate metrics ──────────────────────────────────────────── */}
      {stats.totalStages > 0 && (
        <section aria-labelledby="stats-heading">
          <div className="flex items-center gap-1 mb-3">
            <h2
              id="stats-heading"
              className="text-sm font-semibold text-muted-foreground uppercase tracking-wide"
            >
              Aggregate stats
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Avg HF"
              value={formatHF(stats.overallAvgHF)}
            />
            <StatCard
              label="Match %"
              value={formatPct(stats.overallMatchPct)}
            />
            <StatCard
              label="A-zone %"
              value={formatPct(stats.aPercent)}
              sub={
                stats.missPercent != null
                  ? `Miss: ${formatPct(stats.missPercent)}`
                  : undefined
              }
            />
            <StatCard
              label="HF trend"
              value={<TrendIndicator slope={stats.hfTrendSlope} />}
              sub={
                stats.consistencyCV != null
                  ? `CV: ${(stats.consistencyCV * 100).toFixed(1)}%`
                  : undefined
              }
            />
          </div>

          {/* Accuracy breakdown */}
          {stats.aPercent != null && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground">Accuracy:</span>
              <span className="text-xs font-medium">
                A&nbsp;{formatPct(stats.aPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                C&nbsp;{formatPct(stats.cPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                D&nbsp;{formatPct(stats.dPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                M&nbsp;{formatPct(stats.missPercent)}
              </span>
            </div>
          )}
        </section>
      )}

      {/* ── Trend charts ───────────────────────────────────────────────── */}
      {hasChartData && (
        <section
          aria-labelledby="trends-heading"
          className="border border-border rounded-xl p-4"
        >
          <h2
            id="trends-heading"
            className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4"
          >
            Performance trends
          </h2>
          <TrendChart data={data} />
        </section>
      )}

      {/* ── Match history ──────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold m-0 leading-none">
          <button
            type="button"
            id="history-heading"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="history-panel"
            className="flex w-full items-center justify-between text-left gap-2 mb-3 min-h-[2.75rem]"
          >
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-wide">
                Match history
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                ({matches.length}
                {matchCount > matches.length ? ` of ${matchCount}` : ""})
              </span>
            </span>
            {historyOpen ? (
              <ChevronUp className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        </h2>

        {historyOpen && (
          <div
            id="history-panel"
            role="region"
            aria-labelledby="history-heading"
            className="flex flex-col gap-3"
          >
            <BackfillSection shooterId={shooterId} />

            {matches.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Target className="w-8 h-8" aria-hidden="true" />
                <p className="text-sm">
                  No match history yet. Tap &quot;Find past matches&quot; above, or visit
                  a match you competed in.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {matches.map((match) => (
                  <MatchCard
                    key={`${match.ct}:${match.matchId}`}
                    match={match}
                  />
                ))}
              </div>
            )}

            <AddMatchSection shooterId={shooterId} />
          </div>
        )}
      </section>

      {historyOpen && matchCount > matches.length && (
        <p className="text-xs text-center text-muted-foreground">
          Showing the {matches.length} most recent matches.
        </p>
      )}
    </main>
  );
}
