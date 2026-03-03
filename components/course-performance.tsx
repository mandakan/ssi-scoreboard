"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { Crosshair, Hand, HandMetal, HelpCircle } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse } from "@/lib/types";

interface CoursePerformanceSummaryProps {
  data: CompareResponse;
}

/**
 * Table showing avg group % broken down by course length (Short / Medium / Long).
 * Only rendered when ≥2 distinct course lengths exist across the staged stages.
 */
export function CourseLengthSummary({ data }: CoursePerformanceSummaryProps) {
  const { competitors, courseLengthPerformance } = data;
  if (!courseLengthPerformance) return null;

  // Collect all unique course lengths across all competitors
  const allLengths = new Set<string>();
  for (const compId of competitors.map((c) => c.id)) {
    const perfs = courseLengthPerformance[compId];
    if (perfs) {
      for (const p of perfs) allLengths.add(p.courseDisplay);
    }
  }

  if (allLengths.size < 2) return null;

  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const order = ["Short", "Medium", "Long"];
  const visibleLengths = order.filter((l) => allLengths.has(l));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">Course length split</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About course length split"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Course length split</PopoverTitle>
              <PopoverDescription>Average group % by official course-length category.</PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>IPSC match directors assign each stage an official length: <strong>Short</strong> (≤8 rounds), <strong>Medium</strong> (9–24 rounds), or <strong>Long</strong> (≥25 rounds). This uses the authoritative SSI field rather than a rounds heuristic.</p>
              <p>Compare avg group % across lengths to spot if a shooter performs differently on short quick stages vs. long technical courses. A gap &gt;5% between lengths suggests a meaningful performance pattern.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr>
              <th scope="col" className="text-left text-xs text-muted-foreground font-medium pr-3 pb-1">Length</th>
              {competitors.map((comp) => (
                <th
                  key={comp.id}
                  scope="col"
                  className="text-center text-xs font-medium pb-1 px-2 truncate max-w-24"
                  style={{ color: colorMap[comp.id] }}
                >
                  <span className="hidden sm:inline">{comp.name}</span>
                  <span className="sm:hidden">{comp.name.split(" ")[0]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleLengths.map((courseDisplay) => {
              const stageCount = competitors.reduce((max, c) => {
                const perf = courseLengthPerformance[c.id]?.find((p) => p.courseDisplay === courseDisplay);
                return Math.max(max, perf?.stageCount ?? 0);
              }, 0);

              return (
                <tr key={courseDisplay} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <span className="hidden sm:inline">{courseDisplay}</span>
                      <span className="sm:hidden">{courseDisplay.slice(0, 3)}</span>
                      <span
                        className={cn("text-xs", stageCount <= 2 ? "text-amber-500" : "text-muted-foreground")}
                        title={stageCount <= 2 ? `Only ${stageCount} stage${stageCount === 1 ? "" : "s"} — interpret with caution` : undefined}
                      >({stageCount})</span>
                    </span>
                  </td>
                  {competitors.map((comp) => {
                    const perf = courseLengthPerformance[comp.id]?.find((p) => p.courseDisplay === courseDisplay);
                    const pct = perf?.avgGroupPercent;
                    return (
                      <td key={comp.id} className="py-1.5 px-2 text-center tabular-nums text-sm">
                        {pct != null ? formatPct(pct) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Two-row table: Normal vs Constrained stages (strong hand / weak hand / moving targets).
 * Only rendered when the match has ≥1 constrained stage.
 */
export function ConstraintSummary({ data }: CoursePerformanceSummaryProps) {
  const { competitors, constraintPerformance } = data;
  if (!constraintPerformance) return null;

  // Only show when at least one competitor has ≥1 constrained stage
  const hasConstrained = competitors.some(
    (c) => (constraintPerformance[c.id]?.constrained.stageCount ?? 0) > 0
  );
  if (!hasConstrained) return null;

  const colorMap = buildColorMap(competitors.map((c) => c.id));

  const rows: Array<{
    key: "normal" | "constrained";
    label: string;
    shortLabel: string;
    icon: typeof Hand | null;
    iconColor: string;
  }> = [
    { key: "normal",      label: "Normal",      shortLabel: "Normal", icon: null,      iconColor: "" },
    { key: "constrained", label: "Constrained", shortLabel: "Const.", icon: Hand,      iconColor: "text-amber-500" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">Constrained stages</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About constrained stages"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Constrained stages</PopoverTitle>
              <PopoverDescription>Normal vs restricted-technique stage performance.</PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>Stages are marked <strong>constrained</strong> when the stage brief includes a shooting restriction: <span className="inline-flex items-center gap-0.5"><Hand className="w-3 h-3 text-amber-500" aria-hidden="true" /> strong hand only</span>, <span className="inline-flex items-center gap-0.5"><HandMetal className="w-3 h-3 text-cyan-500" aria-hidden="true" /> weak hand only</span>, or <span className="inline-flex items-center gap-0.5"><Crosshair className="w-3 h-3 text-teal-500" aria-hidden="true" /> moving targets</span>.</p>
              <p>A large gap (&gt;5%) between normal and constrained avg group % highlights technique-specific weaknesses worth addressing in training.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr>
              <th scope="col" className="text-left text-xs text-muted-foreground font-medium pr-3 pb-1">Stage type</th>
              {competitors.map((comp) => (
                <th
                  key={comp.id}
                  scope="col"
                  className="text-center text-xs font-medium pb-1 px-2 truncate max-w-24"
                  style={{ color: colorMap[comp.id] }}
                >
                  <span className="hidden sm:inline">{comp.name}</span>
                  <span className="sm:hidden">{comp.name.split(" ")[0]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label, shortLabel, icon: Icon, iconColor }) => {
              const stageCount = competitors.reduce((max, c) => {
                return Math.max(max, constraintPerformance[c.id]?.[key].stageCount ?? 0);
              }, 0);
              if (stageCount === 0) return null;

              return (
                <tr key={key} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className={cn("inline-flex items-center gap-1", Icon ? iconColor : "text-muted-foreground")}>
                      {Icon && <Icon className="w-3 h-3 flex-none" aria-hidden="true" />}
                      <span className="hidden sm:inline">{label}</span>
                      <span className="sm:hidden">{shortLabel}</span>
                      <span
                        className={cn("text-xs", stageCount <= 2 ? "text-amber-500" : "text-muted-foreground")}
                        title={stageCount <= 2 ? `Only ${stageCount} stage${stageCount === 1 ? "" : "s"} — interpret with caution` : undefined}
                      >({stageCount})</span>
                    </span>
                  </td>
                  {competitors.map((comp) => {
                    const bucket = constraintPerformance[comp.id]?.[key];
                    const pct = bucket?.avgGroupPercent;
                    return (
                      <td key={comp.id} className="py-1.5 px-2 text-center tabular-nums text-sm">
                        {pct != null ? formatPct(pct) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
