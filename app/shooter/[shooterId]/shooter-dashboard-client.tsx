"use client";

import { useMemo, useState, useCallback } from "react";
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
  ArrowLeft,
  Calendar,
  Trophy,
  Swords,
  Crosshair,
  ShieldCheck,
  Ban,
  Award,
  Globe,
  MapPin,
  Shuffle,
  Users,
  Repeat2,
  CalendarDays,
  Sparkles,
  Flag,
  type LucideIcon,
} from "lucide-react";

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  trophy: Trophy,
  swords: Swords,
  crosshair: Crosshair,
  target: Target,
  "shield-check": ShieldCheck,
  ban: Ban,
  award: Award,
  globe: Globe,
  "map-pin": MapPin,
  shuffle: Shuffle,
  users: Users,
  "repeat-2": Repeat2,
  "calendar-days": CalendarDays,
  sparkles: Sparkles,
  flag: Flag,
};
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useShooterDashboardQuery } from "@/lib/queries";
import { triggerBackfill, addMatchToShooter } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  computeAggregateStats,
  computeAZonePct,
  computeMovingAverage,
  getMostFrequentDivision,
  computePenaltyRate,
} from "@/lib/shooter-stats";
import { divisionColor, extractDivisions } from "@/lib/division-colors";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  ShooterMatchSummary,
  BackfillProgress,
  AchievementProgress,
  UpcomingMatch,
} from "@/lib/types";
import { CATEGORY_DISPLAY, regionToFlagEmoji } from "@/lib/ipsc-categories";

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

// ─── Chip button style ───────────────────────────────────────────────────────

function chipClass(active: boolean) {
  return cn(
    "rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[2rem]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted text-muted-foreground hover:bg-muted/80",
  );
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

// ─── Upcoming match card ─────────────────────────────────────────────────────

function UpcomingMatchCard({ match }: { match: UpcomingMatch }) {
  const href = `/match/${match.ct}/${match.matchId}?competitors=${match.competitorId}`;
  const badge = levelBadge(match.level);

  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors group min-h-[44px]"
      aria-label={`Upcoming: ${match.name}${match.date ? `, ${formatDate(match.date)}` : ""}`}
    >
      <Calendar
        className="w-4 h-4 text-muted-foreground shrink-0"
        aria-hidden="true"
      />
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
          {match.venue && (
            <span className="text-xs text-muted-foreground">
              · {match.venue}
            </span>
          )}
          {match.division && (
            <span className="text-xs text-muted-foreground">
              · {match.division}
            </span>
          )}
        </div>
      </div>
      <ChevronRight
        className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors"
        aria-hidden="true"
      />
    </Link>
  );
}

// ─── Division filter ──────────────────────────────────────────────────────────

function DivisionFilter({
  divisions,
  selected,
  onChange,
}: {
  divisions: string[];
  selected: string | null;
  onChange: (div: string | null) => void;
}) {
  if (divisions.length < 2) return null;

  return (
    <ToggleGroup
      type="single"
      value={selected ?? ""}
      onValueChange={(v) => { onChange(v === "" ? null : v || null); }}
      aria-label="Filter by division"
      className="flex flex-wrap gap-1.5 mb-3"
    >
      <ToggleGroupItem
        value=""
        className={chipClass(selected === null)}
      >
        All
      </ToggleGroupItem>
      {divisions.map((div) => (
        <ToggleGroupItem
          key={div}
          value={div}
          className={chipClass(selected === div)}
        >
          <span
            className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
            style={{ backgroundColor: divisionColor(div) }}
            aria-hidden="true"
          />
          {div}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ─── Custom chart tooltip ────────────────────────────────────────────────────

interface ChartDataPoint {
  label: string;
  matchName: string;
  division: string | null;
  level: string | null;
  competitorsInDivision: number | null;
  avgHF: number | null;
  matchPct: number | null;
  aZonePct: number | null;
  penaltyRate: number | null;
  consistencyIndex: number | null;
  avgHF_ma: number | null;
  matchPct_ma: number | null;
  aZonePct_ma: number | null;
  penaltyRate_ma: number | null;
  consistencyIndex_ma: number | null;
  divColor: string;
}

function CustomTooltip({
  active,
  payload,
  metricKey,
  metricLabel,
  formatValue,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
  metricKey: "avgHF" | "matchPct" | "aZonePct" | "penaltyRate" | "consistencyIndex";
  metricLabel: string;
  formatValue: (v: number | null) => string;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const value = d[metricKey];

  return (
    <div
      className="rounded-md border border-border bg-popover text-popover-foreground text-xs p-2.5 shadow-lg max-w-[220px]"
    >
      <p className="font-semibold truncate mb-1">{d.matchName}</p>
      <div className="flex items-center gap-1.5 mb-1">
        {d.division && (
          <>
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: d.divColor }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{d.division}</span>
          </>
        )}
        {d.level && (
          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
            {levelBadge(d.level)}
          </span>
        )}
      </div>
      <p className="font-medium tabular-nums">
        {metricLabel}: {formatValue(value)}
      </p>
      {d.competitorsInDivision != null && (
        <p className="text-muted-foreground mt-0.5">
          {d.competitorsInDivision} in division
        </p>
      )}
    </div>
  );
}

// ─── Custom dot for division colors ──────────────────────────────────────────

function makeDivisionDot(showColors: boolean, dataKey: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function DivDot(props: any) {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    const value = payload?.[dataKey];
    if (value == null) return null;

    const color = showColors ? (payload?.divColor ?? "var(--chart-1)") : "var(--chart-1)";
    // Scale dot radius based on field size when showing division colors
    const nDiv = payload?.competitorsInDivision ?? 0;
    const r = showColors ? Math.min(5, Math.max(2.5, 2.5 + (nDiv / 50) * 2.5)) : 3;

    return <circle cx={cx} cy={cy} r={r} fill={color} stroke="none" />;
  };
}

// ─── Trend chart ──────────────────────────────────────────────────────────────

function TrendChart({
  matches,
  divisionFilter,
}: {
  matches: ShooterMatchSummary[];
  divisionFilter: string | null;
}) {
  const showDivColors = divisionFilter === null;

  const chartData = useMemo(() => {
    const sorted = matches.slice().reverse(); // oldest → newest
    const filtered = sorted.filter((m) => m.avgHF != null || m.matchPct != null);

    const hfValues = filtered.map((m) => m.avgHF != null ? parseFloat(m.avgHF.toFixed(2)) : null);
    const pctValues = filtered.map((m) => m.matchPct != null ? parseFloat(m.matchPct.toFixed(1)) : null);
    const azValues = filtered.map((m) => {
      const az = computeAZonePct(m);
      return az != null ? parseFloat(az.toFixed(1)) : null;
    });
    const penaltyValues = filtered.map((m) => {
      const pr = computePenaltyRate(m);
      return pr != null ? parseFloat((pr * 100).toFixed(2)) : null;
    });
    const ciValues = filtered.map((m) =>
      m.consistencyIndex != null ? parseFloat(m.consistencyIndex.toFixed(1)) : null,
    );

    const hfMa = computeMovingAverage(hfValues, 3);
    const pctMa = computeMovingAverage(pctValues, 3);
    const azMa = computeMovingAverage(azValues, 3);
    const penaltyMa = computeMovingAverage(penaltyValues, 3);
    const ciMa = computeMovingAverage(ciValues, 3);

    return filtered.map((m, i): ChartDataPoint => ({
      label: formatDateShort(m.date),
      matchName: m.name,
      division: m.division,
      level: m.level,
      competitorsInDivision: m.competitorsInDivision,
      avgHF: hfValues[i],
      matchPct: pctValues[i],
      aZonePct: azValues[i],
      penaltyRate: penaltyValues[i],
      consistencyIndex: ciValues[i],
      avgHF_ma: hfMa[i] != null ? parseFloat(hfMa[i]!.toFixed(2)) : null,
      matchPct_ma: pctMa[i] != null ? parseFloat(pctMa[i]!.toFixed(1)) : null,
      aZonePct_ma: azMa[i] != null ? parseFloat(azMa[i]!.toFixed(1)) : null,
      penaltyRate_ma: penaltyMa[i] != null ? parseFloat(penaltyMa[i]!.toFixed(2)) : null,
      consistencyIndex_ma: ciMa[i] != null ? parseFloat(ciMa[i]!.toFixed(1)) : null,
      divColor: divisionColor(m.division),
    }));
  }, [matches]);

  const hasHF = chartData.some((d) => d.avgHF != null);
  const hasPct = chartData.some((d) => d.matchPct != null);
  const hasAZ = chartData.some((d) => d.aZonePct != null);
  const hasPenalty = chartData.some((d) => d.penaltyRate != null);
  const hasCI = chartData.some((d) => d.consistencyIndex != null);
  const hasMA = chartData.length >= 3;

  const hfDot = useMemo(() => makeDivisionDot(showDivColors, "avgHF"), [showDivColors]);
  const pctDot = useMemo(() => makeDivisionDot(showDivColors, "matchPct"), [showDivColors]);
  const azDot = useMemo(() => makeDivisionDot(showDivColors, "aZonePct"), [showDivColors]);
  const penaltyDot = useMemo(() => makeDivisionDot(showDivColors, "penaltyRate"), [showDivColors]);
  const ciDot = useMemo(() => makeDivisionDot(showDivColors, "consistencyIndex"), [showDivColors]);

  if (chartData.length < 2) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {chartData.length === 0
          ? "No match data for this division."
          : "Only 1 match in this division — need at least 2 to show trends."}
      </p>
    );
  }

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
                  When &quot;All&quot; divisions is selected, dots are colored by
                  division so you can see which division each match was shot in.
                  Dot size scales with field strength (more competitors = larger dot).
                  The dashed line is a 3-match moving average.
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
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
                  content={
                    <CustomTooltip
                      metricKey="avgHF"
                      metricLabel="Avg HF"
                      formatValue={(v) => v != null ? v.toFixed(2) : "—"}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                />
                <Line
                  type="monotone"
                  dataKey="avgHF"
                  name="Avg HF"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={hfDot}
                  connectNulls={false}
                />
                {hasMA && (
                  <Line
                    type="monotone"
                    dataKey="avgHF_ma"
                    name="3-match avg"
                    stroke="var(--chart-1)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls={false}
                  />
                )}
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
                  This normalises for match difficulty. Use the division filter to
                  compare like-for-like across the same division. The dashed line
                  is a 3-match moving average.
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
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
                  content={
                    <CustomTooltip
                      metricKey="matchPct"
                      metricLabel="Match %"
                      formatValue={(v) => v != null ? `${v.toFixed(1)}%` : "—"}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                />
                <Line
                  type="monotone"
                  dataKey="matchPct"
                  name="Match %"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={pctDot}
                  connectNulls={false}
                />
                {hasMA && (
                  <Line
                    type="monotone"
                    dataKey="matchPct_ma"
                    name="3-match avg"
                    stroke="var(--chart-2)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasAZ && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <h3 className="text-sm font-medium">A-zone % over time</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="About the A-zone percentage trend chart"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
                <p className="font-medium">A-zone % over time</p>
                <p className="text-muted-foreground">
                  Percentage of scored hits that were A-zone across all stages
                  in each match. This is the most stable cross-division metric —
                  it measures pure accuracy regardless of division or field strength.
                </p>
                <p className="text-muted-foreground">
                  Use this to track accuracy improvement over time. Unlike HF and
                  Match %, this metric is directly comparable across divisions.
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
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
                  content={
                    <CustomTooltip
                      metricKey="aZonePct"
                      metricLabel="A-zone %"
                      formatValue={(v) => v != null ? `${v.toFixed(1)}%` : "—"}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                />
                <Line
                  type="monotone"
                  dataKey="aZonePct"
                  name="A-zone %"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  dot={azDot}
                  connectNulls={false}
                />
                {hasMA && (
                  <Line
                    type="monotone"
                    dataKey="aZonePct_ma"
                    name="3-match avg"
                    stroke="var(--chart-3)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasPenalty && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <h3 className="text-sm font-medium">Penalty rate over time</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="About the penalty rate trend chart"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
                <p className="font-medium">Penalty rate over time</p>
                <p className="text-muted-foreground">
                  Penalties (misses + no-shoots + procedurals) as a percentage
                  of total rounds fired in each match. Lower is better — it
                  measures how much you are giving away to penalties relative to
                  the number of shots taken.
                </p>
                <p className="text-muted-foreground">
                  A rising trend is a warning sign. If penalty rate climbs while
                  A-zone % stays stable, procedurals and no-shoots are likely
                  the cause rather than inaccuracy.
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  className="fill-muted-foreground"
                  domain={[0, "auto"]}
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  width={40}
                />
                <Tooltip
                  content={
                    <CustomTooltip
                      metricKey="penaltyRate"
                      metricLabel="Penalty rate"
                      formatValue={(v) => (v != null ? `${v.toFixed(2)}%` : "—")}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                />
                <Line
                  type="monotone"
                  dataKey="penaltyRate"
                  name="Penalty rate"
                  stroke="var(--chart-4)"
                  strokeWidth={2}
                  dot={penaltyDot}
                  connectNulls={false}
                />
                {hasMA && (
                  <Line
                    type="monotone"
                    dataKey="penaltyRate_ma"
                    name="3-match avg"
                    stroke="var(--chart-4)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasCI && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <h3 className="text-sm font-medium">Consistency index over time</h3>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="About the consistency index trend chart"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
                <p className="font-medium">Consistency index over time</p>
                <p className="text-muted-foreground">
                  Measures how evenly you performed across all stages in a
                  match. Computed as (1 − CV) × 100, where CV is the
                  coefficient of variation of your per-stage hit factors.
                  Higher is better — 100 means every stage had the same hit
                  factor.
                </p>
                <p className="text-muted-foreground">
                  A sharp drop often signals one blown stage that dragged the
                  average down. Pair this with the Match % chart to
                  distinguish a bad stage from a bad overall match.
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
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
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
                  content={
                    <CustomTooltip
                      metricKey="consistencyIndex"
                      metricLabel="Consistency"
                      formatValue={(v) => (v != null ? v.toFixed(1) : "—")}
                    />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
                />
                <Line
                  type="monotone"
                  dataKey="consistencyIndex"
                  name="Consistency index"
                  stroke="var(--chart-5)"
                  strokeWidth={2}
                  dot={ciDot}
                  connectNulls={false}
                />
                {hasMA && (
                  <Line
                    type="monotone"
                    dataKey="consistencyIndex_ma"
                    name="3-match avg"
                    stroke="var(--chart-5)"
                    strokeWidth={1.5}
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    dot={false}
                    connectNulls={false}
                  />
                )}
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
          aria-label="Scan matches previously viewed on this app to find ones you competed in"
        >
          <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">Find past matches</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Searches matches previously viewed on this app. Only finds
              competitions someone has already opened here — not all SSI
              matches.
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
            {lastResult.totalCached} match{lastResult.totalCached !== 1 ? "es" : ""} on
            this app were checked
            {lastResult.alreadyIndexed > 0 && ` · ${lastResult.alreadyIndexed} already in your history`}
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
    <Collapsible open={open} onOpenChange={setOpen}>
      <h3 className="text-sm font-semibold m-0 leading-none">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            id="add-match-heading"
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
        </CollapsibleTrigger>
      </h3>

      <CollapsibleContent>
        <section
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
              Use this for matches that weren&apos;t found by the scan above.
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
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Achievement card ────────────────────────────────────────────────────

const TIER_COLORS: Record<number, string> = {
  1: "bg-zinc-400/20 text-zinc-600 dark:text-zinc-400",
  2: "bg-green-400/20 text-green-700 dark:text-green-400",
  3: "bg-blue-400/20 text-blue-700 dark:text-blue-400",
  4: "bg-purple-400/20 text-purple-700 dark:text-purple-400",
  5: "bg-amber-400/20 text-amber-700 dark:text-amber-400",
  6: "bg-rose-400/20 text-rose-700 dark:text-rose-400",
};

function tierSummary(achievement: AchievementProgress): string {
  const { definition, unlockedTiers } = achievement;
  const total = definition.tiers.length;
  const unlocked = unlockedTiers.length;
  if (unlocked === 0) return `0 of ${total} tiers unlocked`;
  if (unlocked === total) return `All ${total} tiers unlocked`;
  return `${unlocked} of ${total} tiers unlocked`;
}

// ─── Achievement bubble (collapsed ribbon bar) ───────────────────────────────

function AchievementBubbleButton({ achievement }: { achievement: AchievementProgress }) {
  const { definition, unlockedTiers, nextTier, progressToNext } = achievement;
  const highestTier = unlockedTiers.length > 0 ? unlockedTiers[unlockedTiers.length - 1] : null;
  const highestDef = highestTier
    ? definition.tiers.find((t) => t.level === highestTier.level)
    : null;
  const Icon = ACHIEVEMENT_ICONS[definition.icon] ?? HelpCircle;
  const colorClass = highestTier
    ? (TIER_COLORS[highestTier.level] ?? TIER_COLORS[1])
    : "bg-muted/40 text-muted-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            colorClass,
            !highestTier && "opacity-40",
          )}
          aria-label={`${definition.name}: ${highestDef ? highestDef.name : "Locked"}. ${tierSummary(achievement)}`}
        >
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
        <p className="font-medium flex items-center gap-1.5">
          <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          {definition.name}
        </p>
        <p className="text-muted-foreground">{definition.description}</p>
        <div className="space-y-1">
          {definition.tiers.map((tier) => {
            const unlocked = unlockedTiers.some((u) => u.level === tier.level);
            return (
              <div
                key={tier.level}
                className={cn(
                  "flex items-center gap-2 text-xs",
                  unlocked ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span aria-hidden="true">{unlocked ? "\u2713" : "\u25CB"}</span>
                <span className="font-medium">{tier.name}</span>
                <span className="text-muted-foreground">{tier.label}</span>
              </div>
            );
          })}
        </div>
        {nextTier && (
          <div className="pt-1">
            <Progress
              value={progressToNext * 100}
              className="h-1.5"
              aria-label={`${Math.round(progressToNext * 100)}% to ${nextTier.name}`}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {Math.round(progressToNext * 100)}% to {nextTier.name} — {nextTier.label}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Achievement card ────────────────────────────────────────────────────

function AchievementCard({ achievement }: { achievement: AchievementProgress }) {
  const { definition, unlockedTiers, nextTier, progressToNext } = achievement;
  const highestTier = unlockedTiers.length > 0 ? unlockedTiers[unlockedTiers.length - 1] : null;
  const highestDef = highestTier
    ? definition.tiers.find((t) => t.level === highestTier.level)
    : null;
  const isLocked = unlockedTiers.length === 0;
  const Icon = ACHIEVEMENT_ICONS[definition.icon] ?? HelpCircle;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex flex-col justify-between rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50 h-24",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isLocked && "opacity-50",
          )}
          aria-label={`${definition.name}: ${highestDef ? highestDef.name : "Locked"}. ${tierSummary(achievement)}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold truncate">
                  {definition.name}
                </span>
                {highestDef && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      TIER_COLORS[highestTier!.level] ?? TIER_COLORS[1],
                    )}
                  >
                    {highestDef.name}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Progress
              value={nextTier ? progressToNext * 100 : 100}
              className="h-1.5 flex-1"
              aria-label={nextTier ? `${Math.round(progressToNext * 100)}% to ${nextTier.name}` : "Complete"}
            />
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {nextTier ? nextTier.label : "Complete"}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
        <p className="font-medium flex items-center gap-1.5">
          <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          {definition.name}
        </p>
        <p className="text-muted-foreground">{definition.description}</p>
        <div className="space-y-1">
          {definition.tiers.map((tier) => {
            const unlocked = unlockedTiers.some((u) => u.level === tier.level);
            return (
              <div
                key={tier.level}
                className={cn(
                  "flex items-center gap-2 text-xs",
                  unlocked ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span aria-hidden="true">{unlocked ? "\u2713" : "\u25CB"}</span>
                <span className="font-medium">{tier.name}</span>
                <span className="text-muted-foreground">{tier.label}</span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AchievementsSection({
  achievements,
}: {
  achievements: AchievementProgress[];
}) {
  const [open, setOpen] = useState(false);
  const totalTiers = achievements.reduce(
    (s, a) => s + a.definition.tiers.length,
    0,
  );
  const unlockedCount = achievements.reduce(
    (s, a) => s + a.unlockedTiers.length,
    0,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section>
        <h2 className="text-sm font-semibold m-0 leading-none flex items-center">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              id="achievements-heading"
              className="flex flex-1 items-center gap-2 text-left min-h-[2.75rem]"
            >
              {open ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              )}
              <span className="text-muted-foreground uppercase tracking-wide text-xs">
                Achievements
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                ({unlockedCount}/{totalTiers})
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                Preview
              </Badge>
            </button>
          </CollapsibleTrigger>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="About achievements"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-xs text-sm space-y-2" side="top">
              <p className="font-medium">Achievements</p>
              <p className="text-muted-foreground">
                Each achievement has multiple tiers that unlock progressively as
                you compete. Tiers range from beginner milestones to elite goals
                that take dozens of matches to reach.
              </p>
              <p className="text-muted-foreground">
                Tap any icon to see the full unlock ladder and your progress
                through it. Unlocked tiers are permanent — they persist even if
                old match data is pruned.
              </p>
            </PopoverContent>
          </Popover>
        </h2>

        {/* Collapsed: ribbon bar of tappable icon bubbles */}
        {!open && (
          <div
            className="flex flex-wrap gap-1.5 mt-1.5 pl-6"
            role="list"
            aria-label="Achievement overview — tap to inspect"
          >
            {achievements.map((a) => (
              <div key={a.definition.id} role="listitem">
                <AchievementBubbleButton achievement={a} />
              </div>
            ))}
          </div>
        )}

        {/* Expanded: full medal cards */}
        <CollapsibleContent>
          <section
            role="region"
            aria-labelledby="achievements-heading"
            className="mt-1"
          >
            <p className="text-xs text-muted-foreground mb-3">
              {unlockedCount} of {totalTiers} tiers unlocked. Tap a card to see
              the full ladder.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {achievements.map((a) => (
                <AchievementCard key={a.definition.id} achievement={a} />
              ))}
            </div>
          </section>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

interface Props {
  shooterId: number | null;
  from?: string;
}

export function ShooterDashboardClient({ shooterId, from }: Props) {
  const { data, isLoading, isError, error } = useShooterDashboardQuery(
    shooterId,
  );
  const [historyOpen, setHistoryOpen] = useState(true);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [divisionFilter, setDivisionFilter] = useState<string | null | "unset">("unset");

  // Derive divisions and default filter once data loads
  const divisions = useMemo(
    () => (data ? extractDivisions(data.matches) : []),
    [data],
  );
  const effectiveFilter = useMemo(() => {
    if (divisionFilter === "unset") {
      // Auto-default to most frequent division when multiple exist
      if (divisions.length >= 2 && data) {
        return getMostFrequentDivision(data.matches);
      }
      return null;
    }
    return divisionFilter;
  }, [divisionFilter, divisions, data]);

  const handleFilterChange = useCallback((div: string | null) => {
    setDivisionFilter(div);
  }, []);

  // Filtered matches & stats
  const filteredMatches = useMemo(() => {
    if (!data) return [];
    if (effectiveFilter === null) return data.matches;
    return data.matches.filter((m) => m.division === effectiveFilter);
  }, [data, effectiveFilter]);

  const filteredStats = useMemo(
    () => computeAggregateStats(filteredMatches),
    [filteredMatches],
  );

  const isFiltered = effectiveFilter !== null && divisions.length >= 2;

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
            ? "No match history found yet. Open any match you competed in on this app, and your stats will start building automatically."
            : "Could not load shooter stats. Please try again later."}
        </p>
      </main>
    );
  }

  const { profile, matchCount, matches, stats } = data;
  const displayName = profile?.name ?? `Shooter #${shooterId}`;
  // Show trends section if ALL matches have enough data (not filtered) —
  // so the division filter stays accessible even when a filtered division has <2 matches.
  const hasChartData =
    matches.filter((m) => m.avgHF != null || m.matchPct != null).length >= 2;

  // Use filtered stats for the stat cards when a division is selected
  const displayStats = isFiltered ? filteredStats : stats;

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
      {/* ── Back navigation ───────────────────────────────────────────── */}
      <Link
        href={from ?? "/"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground self-start"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        {from ? "Back to match" : "All matches"}
      </Link>
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
            {(() => {
              const flag = regionToFlagEmoji(profile?.region ?? null);
              const label = profile?.region_display ?? null;
              if (!flag && !label) return null;
              return (
                <span aria-label={label ?? undefined}>
                  {flag}{label ? ` ${label}` : ""}
                </span>
              );
            })()}
            {(() => {
              const cat = profile?.category ? CATEGORY_DISPLAY[profile.category] : "";
              return cat ? <span>{cat}</span> : null;
            })()}
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
          {/* Achievement ribbon — tiny at-a-glance dots, decorative only */}
          {data.achievements && data.achievements.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-2" aria-hidden="true">
              {data.achievements.map((a) => {
                const highestTier =
                  a.unlockedTiers.length > 0
                    ? a.unlockedTiers[a.unlockedTiers.length - 1].level
                    : null;
                const Icon = ACHIEVEMENT_ICONS[a.definition.icon] ?? HelpCircle;
                return (
                  <div
                    key={a.definition.id}
                    className={cn(
                      "w-3.5 h-3.5 rounded-full flex items-center justify-center",
                      highestTier
                        ? (TIER_COLORS[highestTier] ?? TIER_COLORS[1])
                        : "bg-muted/30 text-muted-foreground opacity-25",
                    )}
                  >
                    <Icon className="w-2 h-2" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Aggregate metrics ──────────────────────────────────────────── */}
      {displayStats.totalStages > 0 && (
        <section aria-labelledby="stats-heading">
          <div className="flex items-center gap-1 mb-3">
            <h2
              id="stats-heading"
              className="text-sm font-semibold text-muted-foreground uppercase tracking-wide"
            >
              Aggregate stats
            </h2>
            {isFiltered && (
              <span className="text-xs text-muted-foreground">
                ({filteredMatches.length} in {effectiveFilter})
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="Avg HF"
              value={formatHF(displayStats.overallAvgHF)}
            />
            <StatCard
              label="Match %"
              value={formatPct(displayStats.overallMatchPct)}
            />
            <StatCard
              label="A-zone %"
              value={formatPct(displayStats.aPercent)}
              sub={
                displayStats.missPercent != null
                  ? `Miss: ${formatPct(displayStats.missPercent)}`
                  : undefined
              }
            />
            <StatCard
              label="HF trend"
              value={<TrendIndicator slope={displayStats.hfTrendSlope} />}
              sub={
                displayStats.consistencyCV != null
                  ? `CV: ${(displayStats.consistencyCV * 100).toFixed(1)}%`
                  : undefined
              }
            />
          </div>

          {/* Accuracy breakdown */}
          {displayStats.aPercent != null && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              <span className="text-xs text-muted-foreground">Accuracy:</span>
              <span className="text-xs font-medium">
                A&nbsp;{formatPct(displayStats.aPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                C&nbsp;{formatPct(displayStats.cPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                D&nbsp;{formatPct(displayStats.dPercent)}
              </span>
              <span className="text-xs text-muted-foreground">
                M&nbsp;{formatPct(displayStats.missPercent)}
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
          <DivisionFilter
            divisions={divisions}
            selected={effectiveFilter}
            onChange={handleFilterChange}
          />
          <TrendChart
            matches={filteredMatches}
            divisionFilter={effectiveFilter}
          />
        </section>
      )}

      {/* ── Achievements (preview) ──────────────────────────────────── */}
      {data.achievements && data.achievements.length > 0 && (
        <AchievementsSection achievements={data.achievements} />
      )}

      {/* ── Upcoming matches ──────────────────────────────────────────── */}
      {data.upcomingMatches && data.upcomingMatches.length > 0 && (
        <Collapsible open={upcomingOpen} onOpenChange={setUpcomingOpen} asChild>
          <section>
            <h2 className="text-sm font-semibold m-0 leading-none">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  id="upcoming-heading"
                  className="flex w-full items-center justify-between text-left gap-2 mb-3 min-h-[2.75rem]"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground uppercase tracking-wide">
                      Upcoming
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      ({data.upcomingMatches.length})
                    </span>
                  </span>
                  {upcomingOpen ? (
                    <ChevronUp className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 flex-none text-muted-foreground" aria-hidden="true" />
                  )}
                </button>
              </CollapsibleTrigger>
            </h2>

            <CollapsibleContent>
              <div
                role="region"
                aria-labelledby="upcoming-heading"
                className="flex flex-col gap-2"
              >
                {data.upcomingMatches.map((match) => (
                  <UpcomingMatchCard
                    key={`${match.ct}:${match.matchId}`}
                    match={match}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>
      )}

      {/* ── Match history ──────────────────────────────────────────────── */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} asChild>
        <section>
          <h2 className="text-sm font-semibold m-0 leading-none">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                id="history-heading"
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
            </CollapsibleTrigger>
          </h2>

          <CollapsibleContent>
            <div
              role="region"
              aria-labelledby="history-heading"
              className="flex flex-col gap-3"
            >
              <BackfillSection shooterId={shooterId} />

              {matches.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                  <Target className="w-8 h-8" aria-hidden="true" />
                  <p className="text-sm">
                    No match history yet. Matches appear here when you or anyone
                    else views them on this app. Try &quot;Find past matches&quot;
                    above, or paste a match URL below to add one directly.
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
          </CollapsibleContent>
        </section>
      </Collapsible>

      {historyOpen && matchCount > matches.length && (
        <p className="text-xs text-center text-muted-foreground">
          Showing the {matches.length} most recent matches.
        </p>
      )}
    </main>
  );
}
