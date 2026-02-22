"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatHF, formatTime, formatPct } from "@/lib/utils";
import { buildColorMap } from "@/lib/colors";
import { HitZoneBar } from "@/components/hit-zone-bar";
import type { CompareResponse, CompetitorSummary, PctMode } from "@/lib/types";

interface ComparisonTableProps {
  data: CompareResponse;
}

const RANK_COLORS = ["bg-yellow-400", "bg-gray-300", "bg-amber-600"];

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

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">% relative to:</span>
        <ModeToggle mode={mode} onChange={setMode} />
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
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">
                      Stage {stage.stage_num}
                    </span>
                    <span className="truncate max-w-32">{stage.stage_name}</span>
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
                <div>Total pts</div>
                <div>Avg {MODE_LABELS[mode]} %</div>
              </td>
              {totals.map((t) => (
                <td key={t.id} className="py-2 px-2 sm:px-3 text-center">
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

function StageCell({
  sc,
  maxPoints,
  mode,
  groupSize,
  divisionName,
}: {
  sc: CompetitorSummary | undefined;
  maxPoints: number;
  mode: PctMode;
  groupSize: number;
  divisionName: string | null;
}) {
  if (!sc) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (sc.dnf) {
    return (
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
    );
  }

  if (sc.dq) {
    return (
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
    );
  }

  if (sc.zeroed) {
    return (
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
    );
  }

  const { rank, pct } = modeValues(sc, mode);

  return (
    <div className="flex flex-col items-center gap-0.5">
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
