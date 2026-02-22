"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Flame, Shield, Zap } from "lucide-react";
import { cn, formatHF, formatTime, formatPct, computePointsDelta, formatDelta } from "@/lib/utils";
import { buildColorMap } from "@/lib/colors";
import { HitZoneBar } from "@/components/hit-zone-bar";
import type { CompareResponse, CompetitorInfo, CompetitorSummary, LossBreakdownStats, PctMode, StageClassification, ViewMode } from "@/lib/types";

interface ComparisonTableProps {
  data: CompareResponse;
}

/**
 * Inline SVG range strip showing where this competitor sits in the full field
 * pts/shot distribution. The dot marks the competitor's value; the tick marks
 * the field median; the bar spans min–max.
 */
function FieldDistributionStrip({
  value,
  fieldMin,
  fieldMedian,
  fieldMax,
  fieldCount,
}: {
  value: number | null;
  fieldMin: number | null;
  fieldMedian: number | null;
  fieldMax: number | null;
  fieldCount: number;
}) {
  if (
    value == null ||
    fieldMin == null ||
    fieldMax == null ||
    fieldMin === fieldMax
  )
    return null;

  const range = fieldMax - fieldMin;
  const toPx = (v: number) => 2 + ((v - fieldMin) / range) * 52;
  const valuePx = toPx(value);
  const medianPx = fieldMedian != null ? toPx(fieldMedian) : null;

  const label = `${value.toFixed(2)} pts/shot — field: ${fieldMin.toFixed(2)}–${fieldMax.toFixed(2)}${fieldMedian != null ? `, median ${fieldMedian.toFixed(2)}` : ""} (${fieldCount} competitors)`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <svg
          width="56"
          height="12"
          aria-label={label}
          role="img"
          className="cursor-help"
        >
          {/* Range bar */}
          <rect x="2" y="5" width="52" height="2" rx="1" fill="currentColor" opacity="0.2" />
          {/* Median tick */}
          {medianPx != null && (
            <rect
              x={medianPx - 0.5}
              y="3"
              width="1"
              height="6"
              fill="currentColor"
              opacity="0.45"
            />
          )}
          {/* Competitor dot */}
          <circle cx={valuePx} cy="6" r="3" fill="currentColor" opacity="0.85" />
        </svg>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-56 text-center">
        {`${value.toFixed(2)} pts/shot · field range: ${fieldMin.toFixed(2)}–${fieldMax.toFixed(2)}`}
        {fieldMedian != null && ` · median: ${fieldMedian.toFixed(2)}`}
        {` (${fieldCount} competitors)`}
      </TooltipContent>
    </Tooltip>
  );
}

const DIFFICULTY_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "text-emerald-500",
  2: "text-lime-500",
  3: "text-yellow-500",
  4: "text-orange-500",
  5: "text-red-500",
};

function StageDifficultyIcon({
  level,
  label,
  medianHF,
}: {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  medianHF: number | null;
}) {
  const color = DIFFICULTY_COLORS[level];
  const tooltipText = medianHF != null
    ? `${label.charAt(0).toUpperCase() + label.slice(1)} — field median HF: ${formatHF(medianHF)}`
    : `${label.charAt(0).toUpperCase() + label.slice(1)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-end gap-px cursor-help leading-none", color)}
          aria-label={`Difficulty: ${label}`}
          role="img"
        >
          {[1, 2, 3, 4, 5].map((bar) => (
            <span
              key={bar}
              aria-hidden="true"
              className={cn(
                "inline-block w-1 rounded-sm",
                bar <= level ? "opacity-100" : "opacity-20"
              )}
              style={{ height: `${bar * 3 + 3}px` }}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

const RANK_COLORS = ["bg-yellow-400", "bg-gray-300", "bg-amber-600"];

function ordinal(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function PenaltyBadge({
  miss,
  noShoots,
  procedurals,
}: {
  miss: number | null;
  noShoots: number | null;
  procedurals: number | null;
}) {
  const m = miss ?? 0;
  const ns = noShoots ?? 0;
  const p = procedurals ?? 0;
  const total = (m + ns + p) * 10;

  if (total === 0) return null;

  const parts: string[] = [];
  if (m > 0) parts.push(`${m} miss (\u2212${m * 10})`);
  if (ns > 0) parts.push(`${ns} no-shoot (\u2212${ns * 10})`);
  if (p > 0) parts.push(`${p} procedural (\u2212${p * 10})`);
  const tooltipText = `${parts.join(" + ")} = \u2212${total} pts`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums cursor-help"
          aria-label={`Penalties: ${tooltipText}`}
        >
          {`\u2212${total}pts`}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

const CLASSIFICATION_CONFIG: Record<
  StageClassification,
  { label: string; color: string; Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
> = {
  solid: { label: "Solid", color: "text-emerald-500", Icon: CheckCircle2 },
  conservative: { label: "Conservative", color: "text-yellow-500", Icon: Shield },
  "over-push": { label: "Over-push", color: "text-orange-500", Icon: Zap },
  meltdown: { label: "Meltdown", color: "text-red-500", Icon: Flame },
};

/**
 * Small dot + icon badge indicating run quality classification.
 * Uses both color and shape to satisfy WCAG color-not-sole-differentiator.
 */
function StageClassificationBadge({
  classification,
  groupPercent,
  aPct,
  miss,
  noShoots,
  procedurals,
}: {
  classification: StageClassification | null;
  groupPercent: number | null;
  aPct: number | null;
  miss: number | null;
  noShoots: number | null;
  procedurals: number | null;
}) {
  if (!classification) return null;
  const { label, color, Icon } = CLASSIFICATION_CONFIG[classification];

  const parts: string[] = [];
  if (groupPercent != null) parts.push(`${groupPercent.toFixed(1)}% HF`);
  if (aPct != null) parts.push(`${aPct.toFixed(0)}% A-zone`);
  const m = miss ?? 0;
  const ns = noShoots ?? 0;
  const proc = procedurals ?? 0;
  if (m + ns + proc > 0) {
    const pen: string[] = [];
    if (m > 0) pen.push(`${m} miss`);
    if (ns > 0) pen.push(`${ns} no-shoot`);
    if (proc > 0) pen.push(`${proc} procedural`);
    parts.push(pen.join(", "));
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-center gap-0.5 cursor-help leading-none", color)}
          aria-label={`Run classification: ${label}`}
          role="img"
        >
          <span
            className="w-2 h-2 rounded-full bg-current"
            aria-hidden={true}
          />
          <Icon className="w-3 h-3" aria-hidden={true} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-0.5">
        <div className="font-medium">{label}</div>
        {parts.length > 0 && (
          <div className="text-muted-foreground">{parts.join(" · ")}</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Horizontal stacked bar showing: remaining points / hit-quality loss / penalty loss.
 * Width is proportional to best-possible (a_max) score.
 * Only rendered when we have hit zone data so the bar is meaningful.
 */
function LossStackedBar({
  stats,
  totalPossible,
}: {
  stats: LossBreakdownStats;
  totalPossible: number;
}) {
  if (!stats.hasHitZoneData || totalPossible === 0) return null;

  const remaining = totalPossible - stats.totalHitLoss - stats.totalPenaltyLoss;
  const remainPct = Math.max(0, (remaining / totalPossible) * 100);
  const hitLossPct = Math.max(0, (stats.totalHitLoss / totalPossible) * 100);
  const penaltyLossPct = Math.max(0, (stats.totalPenaltyLoss / totalPossible) * 100);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex h-3 w-full rounded overflow-hidden cursor-help"
          role="img"
          aria-label={`Points breakdown: ${remaining} scored, ${stats.totalHitLoss} hit-quality loss, ${stats.totalPenaltyLoss} penalty loss`}
        >
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${remainPct}%` }}
            aria-hidden="true"
          />
          <div
            className="h-full bg-amber-400"
            style={{ width: `${hitLossPct}%` }}
            aria-hidden="true"
          />
          <div
            className="h-full bg-red-500"
            style={{ width: `${penaltyLossPct}%` }}
            aria-hidden="true"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-0.5">
        <div className="font-medium">Points on the table</div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
          {`Scored: ${remaining} pts`}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" aria-hidden="true" />
          {`Hit quality loss: ${stats.totalHitLoss} pts`}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" aria-hidden="true" />
          {`Penalty loss: ${stats.totalPenaltyLoss} pts`}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Per-competitor analysis panel: stacked bar + per-stage breakdown of loss.
 * Only shown when the "Show coaching data" panel is expanded.
 */
function CompetitorLossPanel({
  comp,
  stages,
  stats,
  color,
}: {
  comp: CompetitorInfo;
  stages: CompareResponse["stages"];
  stats: LossBreakdownStats;
  color: string;
}) {
  // Compute total possible across all fired stages for the bar's denominator.
  // total_possible = scored + hit_loss + penalty_loss (i.e. a_max aggregated)
  const totalPossible = stats.totalHitLoss + stats.totalPenaltyLoss +
    stages.reduce((sum, stage) => {
      const sc = stage.competitors[comp.id];
      if (!sc || sc.dnf || sc.dq || sc.zeroed) return sum;
      return sum + (sc.points ?? 0) + sc.penaltyLossPoints;
    }, 0);

  const firedStages = stages.filter((stage) => {
    const sc = stage.competitors[comp.id];
    return sc && !sc.dnf && !sc.dq && !sc.zeroed;
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="text-xs font-medium">{comp.name.split(" ")[0]}</span>
        {stats.totalLoss > 0 && (
          <span className="text-xs text-muted-foreground">
            {`−${stats.totalLoss} pts total`}
            {stats.totalHitLoss > 0 && ` (${stats.totalHitLoss} hit quality`}
            {stats.totalHitLoss > 0 && stats.totalPenaltyLoss > 0 && ` + ${stats.totalPenaltyLoss} penalties)`}
            {stats.totalHitLoss > 0 && stats.totalPenaltyLoss === 0 && `)`}
            {stats.totalHitLoss === 0 && stats.totalPenaltyLoss > 0 && ` (${stats.totalPenaltyLoss} penalties)`}
          </span>
        )}
        {stats.totalLoss === 0 && stats.stagesFired > 0 && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">Perfect A-zone run</span>
        )}
      </div>

      <LossStackedBar stats={stats} totalPossible={totalPossible} />

      {/* Per-stage breakdown table */}
      {firedStages.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1 pr-3 font-normal">Stage</th>
                <th className="text-right py-1 px-2 font-normal">Hit quality loss</th>
                <th className="text-right py-1 px-2 font-normal">Penalty loss</th>
                <th className="text-right py-1 pl-2 font-normal">Total loss</th>
              </tr>
            </thead>
            <tbody>
              {firedStages.map((stage) => {
                const sc = stage.competitors[comp.id];
                if (!sc) return null;
                const hitLoss = sc.hitLossPoints;
                const penLoss = sc.penaltyLossPoints;
                const stageTotalLoss = hitLoss != null ? hitLoss + penLoss : null;
                return (
                  <tr key={stage.stage_id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-1 pr-3 text-muted-foreground">
                      {`S${stage.stage_num}`}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {hitLoss != null ? (
                        <span className={hitLoss > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                          {hitLoss > 0 ? `−${hitLoss}` : "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50" title="Zone data unavailable">n/a</span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      <span className={penLoss > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}>
                        {penLoss > 0 ? `−${penLoss}` : "—"}
                      </span>
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums font-medium">
                      {stageTotalLoss != null ? (
                        <span className={stageTotalLoss > 0 ? "text-foreground" : "text-muted-foreground"}>
                          {stageTotalLoss > 0 ? `−${stageTotalLoss}` : "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">n/a</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RankBadge({
  rank,
  tooltip,
}: {
  rank: number;
  tooltip: string;
}) {
  const color = rank <= 3 ? RANK_COLORS[rank - 1] : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white cursor-help",
            color ?? "bg-muted-foreground"
          )}
        >
          {rank}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

const MODE_LABELS: Record<PctMode, string> = {
  group: "Group",
  division: "Division",
  overall: "Overall",
};

const MODE_TOOLTIPS: Record<PctMode, string> = {
  group: "Hit factor as % of the group leader on this stage (selected competitors only)",
  division:
    "Hit factor as % of the division winner on this stage (full field, within each competitor's own division)",
  overall:
    "Hit factor as % of the overall stage winner (full field, all divisions combined)",
};

function ModeToggle({
  mode,
  onChange,
}: {
  mode: PctMode;
  onChange: (m: PctMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Percentage reference"
      className="inline-flex rounded-md border text-xs"
    >
      {(["group", "division", "overall"] as PctMode[]).map((m) => (
        <Tooltip key={m}>
          <TooltipTrigger asChild>
            <button
              onClick={() => onChange(m)}
              aria-pressed={mode === m}
              className={cn(
                "px-2.5 py-1 first:rounded-l-md last:rounded-r-md transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                mode === m
                  ? "bg-foreground text-background font-medium"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {MODE_LABELS[m]}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-56 text-center text-xs">
            {MODE_TOOLTIPS[m]}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Table view mode"
      className="inline-flex rounded-md border text-xs"
    >
      {(["absolute", "delta"] as ViewMode[]).map((m, i, arr) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          aria-pressed={viewMode === m}
          className={cn(
            "px-2.5 py-1 transition-colors capitalize",
            i === 0 ? "rounded-l-md" : "",
            i === arr.length - 1 ? "rounded-r-md" : "",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            viewMode === m
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {m === "absolute" ? "Absolute" : "Delta"}
        </button>
      ))}
    </div>
  );
}

/**
 * Returns Tailwind bg classes for the delta heatmap cell based on the
 * magnitude of the gap relative to stage max_points.
 * Green = at/near leader; red = far behind.
 */
function deltaColorClasses(delta: number, maxPoints: number): string {
  if (delta >= 0) return "bg-emerald-100 dark:bg-emerald-900/50";
  const ratio = Math.abs(delta) / Math.max(maxPoints, 1);
  if (ratio <= 0.15) return "bg-lime-100 dark:bg-lime-900/50";
  if (ratio <= 0.30) return "bg-amber-100 dark:bg-amber-900/50";
  if (ratio <= 0.50) return "bg-orange-100 dark:bg-orange-900/50";
  return "bg-red-100 dark:bg-red-900/50";
}

/** Pick the rank and percent values for a given mode. */
function modeValues(
  sc: CompetitorSummary,
  mode: PctMode
): { rank: number | null; pct: number | null } {
  switch (mode) {
    case "group":
      return { rank: sc.group_rank, pct: sc.group_percent };
    case "division":
      return { rank: sc.div_rank, pct: sc.div_percent };
    case "overall":
      return { rank: sc.overall_rank, pct: sc.overall_percent };
  }
}

export function ComparisonTable({ data }: ComparisonTableProps) {
  const { stages, competitors, penaltyStats, efficiencyStats, consistencyStats, lossBreakdownStats } = data;
  const [mode, setMode] = useState<PctMode>("group");
  const [viewMode, setViewMode] = useState<ViewMode>("absolute");
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Detect match-level DQ: every scorecard for a competitor has dq: true
  const matchDqCompetitors = competitors.filter((comp) => {
    const scorecards = stages
      .map((s) => s.competitors[comp.id])
      .filter((sc): sc is CompetitorSummary => sc !== undefined);
    return scorecards.length > 0 && scorecards.every((sc) => sc.dq);
  });
  const colorMap = buildColorMap(competitors.map((c) => c.id));

  // Compute totals per competitor: total raw points, average %, zone/penalty sums, and clean match status
  const totals = competitors.map((comp) => {
    let totalPts = 0;
    let pctSum = 0;
    let pctCount = 0;
    let hasFired = false;
    let firedCount = 0;
    let aTotal = 0, cTotal = 0, dTotal = 0, mTotal = 0;
    let nsTotal = 0, pTotal = 0;
    let hasZoneData = false;
    let hasPenaltyData = false;
    let totalPenaltyPts = 0;
    let firedWithAllPenaltyData = 0;
    let totalDelta = 0;
    let deltaCount = 0;
    let totalMaxPts = 0;
    let solidCount = 0;
    let conservativeCount = 0;
    let overpushCount = 0;
    let meltdownCount = 0;

    for (const stage of stages) {
      const sc = stage.competitors[comp.id];
      if (!sc || sc.dnf) continue;
      switch (sc.stageClassification) {
        case "solid": solidCount++; break;
        case "conservative": conservativeCount++; break;
        case "over-push": overpushCount++; break;
        case "meltdown": meltdownCount++; break;
      }
      hasFired = true;
      firedCount++;
      totalPts += sc.points ?? 0;
      const { pct } = modeValues(sc, mode);
      if (pct != null) {
        pctSum += pct;
        pctCount++;
      }
      if (sc.a_hits !== null || sc.c_hits !== null || sc.d_hits !== null || sc.miss_count !== null) {
        hasZoneData = true;
        aTotal += sc.a_hits ?? 0;
        cTotal += sc.c_hits ?? 0;
        dTotal += sc.d_hits ?? 0;
        mTotal += sc.miss_count ?? 0;
      }
      if (sc.no_shoots !== null || sc.procedurals !== null) {
        hasPenaltyData = true;
        nsTotal += sc.no_shoots ?? 0;
        pTotal += sc.procedurals ?? 0;
      }
      if (sc.miss_count !== null && sc.no_shoots !== null && sc.procedurals !== null) {
        firedWithAllPenaltyData++;
        totalPenaltyPts += (sc.miss_count + sc.no_shoots + sc.procedurals) * 10;
      }
      const d = computePointsDelta(sc.points, stage.group_leader_points);
      if (d != null) {
        totalDelta += d;
        deltaCount++;
        totalMaxPts += stage.max_points;
      }
    }

    return {
      id: comp.id,
      points: hasFired ? totalPts : null,
      avgPct: pctCount > 0 ? pctSum / pctCount : null,
      aHits: hasZoneData ? aTotal : null,
      cHits: hasZoneData ? cTotal : null,
      dHits: hasZoneData ? dTotal : null,
      misses: hasZoneData ? mTotal : null,
      noShoots: hasPenaltyData ? nsTotal : null,
      procedurals: hasPenaltyData ? pTotal : null,
      totalPenaltyPts,
      isClean: hasFired && firedCount === firedWithAllPenaltyData && totalPenaltyPts === 0,
      totalDelta: deltaCount > 0 ? totalDelta : null,
      totalMaxPts,
      solidCount,
      conservativeCount,
      overpushCount,
      meltdownCount,
    };
  });

  return (
    <div className="space-y-3">
      {/* Match-level DQ banners */}
      {matchDqCompetitors.map((comp) => (
        <div
          key={comp.id}
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:text-red-400"
        >
          <span className="font-medium">{comp.name}</span>
          <span>— Disqualified from match</span>
        </div>
      ))}

      {/* View mode toggle (Absolute / Delta) */}
      <div className="flex flex-wrap items-center gap-3">
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
        {viewMode === "absolute" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">% relative to:</span>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
                Stage
              </th>
              {competitors.map((comp) => {
                const t = totals.find((x) => x.id === comp.id);
                const hasClassifications = t &&
                  (t.solidCount + t.conservativeCount + t.overpushCount + t.meltdownCount) > 0;
                const classificationSummaryLabel = t ? [
                  t.solidCount > 0 && `${t.solidCount} solid`,
                  t.conservativeCount > 0 && `${t.conservativeCount} conservative`,
                  t.overpushCount > 0 && `${t.overpushCount} over-push`,
                  t.meltdownCount > 0 && `${t.meltdownCount} meltdown`,
                ].filter(Boolean).join(" · ") : "";
                return (
                  <th
                    key={comp.id}
                    className="py-2 px-3 text-center font-medium min-w-[5.5rem] sm:min-w-32"
                    style={{ borderBottom: `3px solid ${colorMap[comp.id]}` }}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{comp.competitor_number}
                      </span>
                      <span>{comp.name.split(" ")[0]}</span>
                      {comp.division && (
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">
                          {comp.division}
                        </span>
                      )}
                      {hasClassifications && t && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex items-center gap-1 cursor-help"
                              aria-label={`Run classification summary: ${classificationSummaryLabel}`}
                            >
                              {t.solidCount > 0 && (
                                <span className="inline-flex items-center gap-px text-[10px] text-emerald-500">
                                  <CheckCircle2 className="w-2.5 h-2.5" aria-hidden={true} />
                                  {t.solidCount}
                                </span>
                              )}
                              {t.conservativeCount > 0 && (
                                <span className="inline-flex items-center gap-px text-[10px] text-yellow-500">
                                  <Shield className="w-2.5 h-2.5" aria-hidden={true} />
                                  {t.conservativeCount}
                                </span>
                              )}
                              {t.overpushCount > 0 && (
                                <span className="inline-flex items-center gap-px text-[10px] text-orange-500">
                                  <Zap className="w-2.5 h-2.5" aria-hidden={true} />
                                  {t.overpushCount}
                                </span>
                              )}
                              {t.meltdownCount > 0 && (
                                <span className="inline-flex items-center gap-px text-[10px] text-red-500">
                                  <Flame className="w-2.5 h-2.5" aria-hidden={true} />
                                  {t.meltdownCount}
                                </span>
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            {classificationSummaryLabel}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage.stage_id} className="border-b hover:bg-muted/30">
                <td className="py-2 pr-4 font-medium">
                  <div className="flex flex-col gap-0.5">
                    {stage.ssi_url ? (
                      <a
                        href={stage.ssi_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Open ${stage.stage_name} on ShootNScoreIt (opens in new tab)`}
                      >
                        Stage {stage.stage_num}
                        <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        <span className="sr-only">(opens in new tab)</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Stage {stage.stage_num}
                      </span>
                    )}
                    <span className="truncate max-w-32">{stage.stage_name}</span>
                    {/* Stage metadata: rounds / targets */}
                    {(stage.min_rounds != null || stage.paper_targets != null ||
                      (stage.steel_targets != null && stage.steel_targets > 0)) && (
                      <span className="text-xs text-muted-foreground/70 tabular-nums">
                        {[
                          stage.min_rounds != null && `${stage.min_rounds} rds`,
                          stage.paper_targets != null && `${stage.paper_targets} paper`,
                          stage.steel_targets != null && stage.steel_targets > 0 && `${stage.steel_targets} steel`,
                        ].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {/* Difficulty icon + field median annotation */}
                    <div className="flex items-center gap-1.5">
                      <StageDifficultyIcon
                        level={stage.stageDifficultyLevel}
                        label={stage.stageDifficultyLabel}
                        medianHF={stage.field_median_hf}
                      />
                      {stage.field_median_hf != null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="text-xs text-muted-foreground/60 tabular-nums cursor-help"
                              aria-label={`Field median hit factor: ${formatHF(stage.field_median_hf)} across ${stage.field_competitor_count} competitors`}
                            >
                              {`med: ${formatHF(stage.field_median_hf)}`}
                              <span className="opacity-60">{` (${stage.field_competitor_count})`}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-52 text-center text-xs">
                            {`Field median hit factor: ${formatHF(stage.field_median_hf)} across ${stage.field_competitor_count} competitors (excludes DNF/DQ/zeroed)`}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </td>
                {competitors.map((comp) => {
                  const sc = stage.competitors[comp.id];
                  return (
                    <td key={comp.id} className="py-2 px-2 sm:px-3 text-center align-top">
                      <StageCell
                        sc={sc}
                        maxPoints={stage.max_points}
                        mode={mode}
                        viewMode={viewMode}
                        groupLeaderPoints={stage.group_leader_points}
                        groupSize={competitors.length}
                        divisionName={comp.division}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Totals row */}
            <tr className="border-t-2 font-semibold bg-muted/20">
              <td className="py-2 pr-4 text-xs text-muted-foreground font-normal">
                {viewMode === "delta" ? (
                  <div>Total deficit</div>
                ) : (
                  <>
                    <div>Total pts</div>
                    <div>Avg {MODE_LABELS[mode]} %</div>
                    <div>pts/shot</div>
                  </>
                )}
              </td>
              {totals.map((t) => (
                <td key={t.id} className="py-2 px-2 sm:px-3 text-center">
                  {viewMode === "delta" ? (
                    <div
                      className={cn(
                        "inline-flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded",
                        t.totalDelta != null
                          ? deltaColorClasses(t.totalDelta, t.totalMaxPts)
                          : ""
                      )}
                    >
                      <span className={cn(
                        "font-semibold tabular-nums",
                        t.totalDelta === 0 ? "text-muted-foreground" : "text-foreground"
                      )}>
                        {t.totalDelta != null ? formatDelta(t.totalDelta) : "—"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-0.5">
                      <span>
                        {t.points != null ? (
                          t.points.toFixed(0)
                        ) : (
                          <span className="text-muted-foreground font-normal">—</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground font-normal">
                        {t.avgPct != null ? formatPct(t.avgPct) : "—"}
                      </span>
                      <HitZoneBar
                        aHits={t.aHits}
                        cHits={t.cHits}
                        dHits={t.dHits}
                        misses={t.misses}
                        noShoots={t.noShoots}
                        procedurals={t.procedurals}
                      />
                      {t.totalPenaltyPts > 0 && (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">
                          {`\u2212${t.totalPenaltyPts}pts`}
                        </span>
                      )}
                      {penaltyStats[t.id]?.totalPenalties > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="text-xs font-medium border-red-400 text-red-600 dark:text-red-400 cursor-help tabular-nums"
                              aria-label={`Penalty cost: ${penaltyStats[t.id].penaltyCostPercent.toFixed(1)}% match percentage`}
                            >
                              {`Penalty cost: \u2212${penaltyStats[t.id].penaltyCostPercent.toFixed(1)}% match`}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs space-y-0.5">
                            <div>{`Without penalties: ${formatPct(penaltyStats[t.id].matchPctActual)} \u2192 ${formatPct(penaltyStats[t.id].matchPctClean)}`}</div>
                            <div className="text-muted-foreground">{`${penaltyStats[t.id].penaltiesPerStage.toFixed(1)} penalties/stage \u00b7 ${penaltyStats[t.id].penaltiesPer100Rounds.toFixed(1)}/100 rounds`}</div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {efficiencyStats[t.id]?.pointsPerShot != null && (
                        <div className="flex flex-col items-center gap-0">
                          <span className="text-xs text-muted-foreground font-normal tabular-nums">
                            {`${efficiencyStats[t.id].pointsPerShot!.toFixed(2)} pts/shot`}
                          </span>
                          <FieldDistributionStrip
                            value={efficiencyStats[t.id].pointsPerShot}
                            fieldMin={efficiencyStats[t.id].fieldMin}
                            fieldMedian={efficiencyStats[t.id].fieldMedian}
                            fieldMax={efficiencyStats[t.id].fieldMax}
                            fieldCount={efficiencyStats[t.id].fieldCount}
                          />
                        </div>
                      )}
                      {consistencyStats[t.id]?.coefficientOfVariation != null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs font-medium cursor-help tabular-nums",
                                consistencyStats[t.id].stagesFired < 4 && "opacity-40"
                              )}
                              aria-label={`Consistency index: ${consistencyStats[t.id].coefficientOfVariation!.toFixed(2)} — ${consistencyStats[t.id].label}`}
                            >
                              {`CI ${consistencyStats[t.id].coefficientOfVariation!.toFixed(2)} · ${consistencyStats[t.id].label}`}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs space-y-0.5 max-w-56 text-center">
                            <div className="font-medium">Consistency Index (CI)</div>
                            <div>Coefficient of variation of HF% across stages. Lower = more consistent.</div>
                            <div className="text-muted-foreground">{`Based on ${consistencyStats[t.id].stagesFired} stage${consistencyStats[t.id].stagesFired === 1 ? "" : "s"}`}</div>
                            <div className="text-muted-foreground">{"< 0.05 very consistent · 0.05–0.10 consistent · 0.10–0.15 moderate · 0.15–0.20 variable · > 0.20 streaky"}</div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {(() => {
                        const lbs = lossBreakdownStats[t.id];
                        if (!lbs || lbs.totalLoss === 0) return null;
                        const hasBoth = lbs.totalHitLoss > 0 && lbs.totalPenaltyLoss > 0;
                        const label = hasBoth
                          ? `−${lbs.totalLoss} pts on table`
                          : lbs.totalPenaltyLoss > 0
                            ? `−${lbs.totalPenaltyLoss} pts to penalties`
                            : `−${lbs.totalHitLoss} pts hit quality`;
                        return (
                          <button
                            onClick={() => setShowAnalysis((v) => !v)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
                              "text-xs font-medium tabular-nums cursor-pointer",
                              "border-amber-400 text-amber-700 dark:text-amber-400",
                              "hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors",
                              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                            )}
                            aria-label={`${label} — click to ${showAnalysis ? "hide" : "show"} coaching analysis`}
                            aria-expanded={showAnalysis}
                          >
                            {label}
                          </button>
                        );
                      })()}
                      {t.isClean && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="text-xs text-green-600 dark:text-green-400 font-medium cursor-help"
                              aria-label="Clean match: no penalties across all fired stages"
                            >
                              ✓ Clean
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            No penalties across all fired stages
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Coaching analysis panel — collapsible, hidden by default */}
      {competitors.some((c) => {
        const lbs = lossBreakdownStats[c.id];
        return lbs && lbs.totalLoss > 0;
      }) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50">
          <button
            onClick={() => setShowAnalysis((v) => !v)}
            className={cn(
              "flex w-full items-center justify-between px-4 py-3 text-sm font-medium",
              "hover:bg-muted/30 transition-colors rounded-lg",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            )}
            aria-expanded={showAnalysis}
            aria-controls="coaching-analysis-panel"
          >
            <span className="flex items-center gap-2">
              <span className="text-amber-700 dark:text-amber-400">Coaching analysis</span>
              <span className="text-xs text-muted-foreground font-normal">
                Points left on the table per shooter
              </span>
            </span>
            {showAnalysis
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            }
          </button>

          {showAnalysis && (
            <div
              id="coaching-analysis-panel"
              className="px-4 pb-4 space-y-5 border-t border-amber-200 dark:border-amber-900/50 pt-4"
            >
              {/* Legend */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" aria-hidden="true" />
                  Scored
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" aria-hidden="true" />
                  Hit quality loss (C/D/miss vs A)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-red-500" aria-hidden="true" />
                  Penalty loss (miss/NS/procedural)
                </span>
              </div>

              {/* Per-competitor breakdown */}
              <div className="space-y-5">
                {competitors.map((comp) => {
                  const lbs = lossBreakdownStats[comp.id];
                  if (!lbs || lbs.stagesFired === 0) return null;
                  return (
                    <CompetitorLossPanel
                      key={comp.id}
                      comp={comp}
                      stages={stages}
                      stats={lbs}
                      color={colorMap[comp.id]}
                    />
                  );
                })}
              </div>

              {/* Explanation note */}
              <p className="text-xs text-muted-foreground/70">
                Hit quality loss = points left on table from C/D/miss vs best possible A-zone.
                Penalty loss = miss + no-shoot + procedural penalties (10 pts each).
                Only valid (non-DQ, non-zeroed, non-DNF) stages are included.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function rankTooltip(
  rank: number,
  mode: PctMode,
  groupSize: number,
  divisionName: string | null
): string {
  switch (mode) {
    case "group":
      return `Rank ${rank} of ${groupSize} in your group`;
    case "division":
      return divisionName
        ? `Rank ${rank} in ${divisionName} (full field)`
        : `Rank ${rank} in division (full field)`;
    case "overall":
      return `Rank ${rank} overall (all divisions)`;
  }
}

function ShootingOrderBadge({ order }: { order: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-[10px] text-muted-foreground/60 tabular-nums cursor-help leading-none"
          aria-label={`Shot this stage ${ordinal(order)} in their rotation`}
        >
          {ordinal(order)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-52 text-center text-xs">
        This was the {ordinal(order)} stage this competitor shot — derived from
        scorecard submission timestamps
      </TooltipContent>
    </Tooltip>
  );
}

function StageCell({
  sc,
  maxPoints,
  mode,
  viewMode,
  groupLeaderPoints,
  groupSize,
  divisionName,
}: {
  sc: CompetitorSummary | undefined;
  maxPoints: number;
  mode: PctMode;
  viewMode: ViewMode;
  groupLeaderPoints: number | null;
  groupSize: number;
  divisionName: string | null;
}) {
  if (!sc) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (sc.dnf) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        {sc.shooting_order != null && (
          <ShootingOrderBadge order={sc.shooting_order} />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className="text-xs cursor-help"
              aria-label="Stage not fired"
              tabIndex={0}
            >
              DNF
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Stage not fired
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (sc.dq) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        {sc.shooting_order != null && (
          <ShootingOrderBadge order={sc.shooting_order} />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="destructive"
              className="text-xs cursor-help"
              aria-label="Disqualified"
              tabIndex={0}
            >
              DQ
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Disqualified — stage scored as 0
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (sc.zeroed) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        {sc.shooting_order != null && (
          <ShootingOrderBadge order={sc.shooting_order} />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs border-orange-400 text-orange-600 cursor-help"
              aria-label="Stage zeroed"
              tabIndex={0}
            >
              0
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Stage zeroed — 0 points, ranked last
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // Delta mode: show gap to group leader with color-coded background
  if (viewMode === "delta") {
    const delta = computePointsDelta(sc.points, groupLeaderPoints);
    return (
      <div
        className={cn(
          "inline-flex flex-col items-center justify-center gap-0.5 py-1 px-2 rounded w-full",
          delta != null ? deltaColorClasses(delta, maxPoints) : ""
        )}
      >
        {sc.shooting_order != null && (
          <ShootingOrderBadge order={sc.shooting_order} />
        )}
        <span
          className={cn(
            "font-semibold tabular-nums text-sm",
            delta === 0 ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {delta != null ? formatDelta(delta) : "—"}
        </span>
      </div>
    );
  }

  const { rank, pct } = modeValues(sc, mode);

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* Shooting order indicator */}
      {sc.shooting_order != null && (
        <ShootingOrderBadge order={sc.shooting_order} />
      )}
      {/* Primary: hit factor + rank badge */}
      <div className="flex items-center gap-1">
        {rank != null && (
          <RankBadge
            rank={rank}
            tooltip={rankTooltip(rank, mode, groupSize, divisionName)}
          />
        )}
        <span className="font-semibold tabular-nums">
          {formatHF(sc.hit_factor)}
        </span>
        {sc.incomplete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex cursor-help text-amber-500 dark:text-amber-400"
                aria-label="Incomplete scorecard (rule 9.7.6.2)"
              >
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-52 text-center text-xs">
              Incomplete scorecard (rule 9.7.6.2) — insufficient hits or misses recorded
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {/* Secondary: raw points and time */}
      <div className="text-xs text-muted-foreground tabular-nums">
        {sc.points != null ? sc.points.toFixed(0) : "—"}
        <span className="opacity-50">/{maxPoints}</span>
        <span className="mx-0.5">·</span>
        {formatTime(sc.time)}
      </div>
      {/* Percentage in selected mode */}
      {pct != null && (
        <span className="text-xs font-medium text-muted-foreground">
          {formatPct(pct)}
        </span>
      )}
      {/* Percentile placement in full field */}
      {sc.overall_percentile != null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="text-[10px] text-muted-foreground/70 tabular-nums cursor-help leading-none"
              aria-label={`Field percentile: P${Math.round(sc.overall_percentile * 100)}`}
            >
              {`P${Math.round(sc.overall_percentile * 100)}`}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-52 text-center text-xs">
            {`P${Math.round(sc.overall_percentile * 100)} — top ${Math.round(sc.overall_percentile * 100)}% of all field competitors on this stage`}
          </TooltipContent>
        </Tooltip>
      )}
      {/* Hit zone distribution bar */}
      <HitZoneBar
        aHits={sc.a_hits}
        cHits={sc.c_hits}
        dHits={sc.d_hits}
        misses={sc.miss_count}
        noShoots={sc.no_shoots}
        procedurals={sc.procedurals}
      />
      {/* Penalty badge */}
      <PenaltyBadge
        miss={sc.miss_count}
        noShoots={sc.no_shoots}
        procedurals={sc.procedurals}
      />
      {/* Run classification badge */}
      {(() => {
        const totalHits =
          (sc.a_hits ?? 0) + (sc.c_hits ?? 0) + (sc.d_hits ?? 0) + (sc.miss_count ?? 0);
        const aPct = totalHits > 0 ? ((sc.a_hits ?? 0) / totalHits) * 100 : null;
        return (
          <StageClassificationBadge
            classification={sc.stageClassification}
            groupPercent={sc.group_percent}
            aPct={aPct}
            miss={sc.miss_count}
            noShoots={sc.no_shoots}
            procedurals={sc.procedurals}
          />
        );
      })()}
    </div>
  );
}
