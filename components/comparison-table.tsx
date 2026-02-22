"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { cn, formatHF, formatTime, formatPct, computePointsDelta, formatDelta } from "@/lib/utils";
import { buildColorMap } from "@/lib/colors";
import { HitZoneBar } from "@/components/hit-zone-bar";
import type { CompareResponse, CompetitorSummary, PctMode, ViewMode } from "@/lib/types";

interface ComparisonTableProps {
  data: CompareResponse;
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
  const { stages, competitors } = data;
  const [mode, setMode] = useState<PctMode>("group");
  const [viewMode, setViewMode] = useState<ViewMode>("absolute");

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

    for (const stage of stages) {
      const sc = stage.competitors[comp.id];
      if (!sc || sc.dnf) continue;
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
              {competitors.map((comp) => (
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
                  </div>
                </th>
              ))}
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
    </div>
  );
}
