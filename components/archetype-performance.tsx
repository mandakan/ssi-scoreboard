"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { Focus, HelpCircle, Layers, Timer } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";
import { buildColorMap, buildShapeMap } from "@/lib/colors";
import { CompetitorLegendSwatch } from "@/components/competitor-marker";
import type { CompareResponse, StageArchetype } from "@/lib/types";

const ARCHETYPE_DISPLAY: Record<StageArchetype, { icon: typeof Timer; label: string; shortLabel: string; color: string }> = {
  speed: { icon: Timer, label: "Speed", shortLabel: "Speed", color: "text-blue-500" },
  precision: { icon: Focus, label: "Precision", shortLabel: "Prec.", color: "text-purple-500" },
  mixed: { icon: Layers, label: "Mixed", shortLabel: "Mixed", color: "text-muted-foreground" },
};

interface ArchetypePerformanceSummaryProps {
  data: CompareResponse;
}

export function ArchetypePerformanceSummary({ data }: ArchetypePerformanceSummaryProps) {
  const { competitors, archetypePerformance } = data;
  if (!archetypePerformance) return null;

  // Collect all unique archetypes across all competitors
  const allArchetypes = new Set<StageArchetype>();
  for (const compId of competitors.map((c) => c.id)) {
    const perfs = archetypePerformance[compId];
    if (perfs) {
      for (const p of perfs) allArchetypes.add(p.archetype);
    }
  }

  // Only render when ≥2 different archetypes exist (otherwise the split is meaningless)
  if (allArchetypes.size < 2) return null;

  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const shapeMap = buildShapeMap(competitors.map((c) => c.id));
  const archetypeOrder: StageArchetype[] = ["speed", "precision", "mixed"];
  const visibleArchetypes = archetypeOrder.filter((a) => allArchetypes.has(a));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">Stage archetype breakdown</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About stage archetypes"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Stage archetype breakdown</PopoverTitle>
              <PopoverDescription>Average performance grouped by stage type.</PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>Stages are classified based on target composition: <strong>Speed</strong> stages have &gt;50% steel targets, <strong>Precision</strong> stages are long courses (&ge;25 rounds) with &le;30% steel, and <strong>Mixed</strong> stages are everything in between.</p>
              <p>Compare average group % across archetypes to spot if a shooter dominates one type but struggles on another. A large gap (&gt;5%) between archetypes suggests targeted practice opportunities.</p>
              <p>The stage count for each row is shown in parentheses. Counts of 1–2 are highlighted in amber — averages from very few stages are less reliable and should be interpreted with caution.</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr>
              <th scope="col" className="text-left text-xs text-muted-foreground font-medium pr-3 pb-1">Type</th>
              {competitors.map((comp) => (
                <th
                  key={comp.id}
                  scope="col"
                  className="text-center text-xs font-medium pb-1 px-2 truncate max-w-24"
                  style={{ color: colorMap[comp.id] }}
                >
                  <span className="inline-flex items-center gap-1 align-middle">
                    <CompetitorLegendSwatch
                      size={10}
                      fill={colorMap[comp.id]}
                      shape={shapeMap[comp.id]}
                    />
                    <span className="hidden sm:inline">{comp.name}</span>
                    <span className="sm:hidden">{comp.name.split(" ")[0]}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleArchetypes.map((archetype) => {
              const { icon: Icon, label, shortLabel, color } = ARCHETYPE_DISPLAY[archetype];
              // Find the stage count (same across competitors since it's stage-level)
              const stageCount = competitors.reduce((max, c) => {
                const perf = archetypePerformance[c.id]?.find((p) => p.archetype === archetype);
                return Math.max(max, perf?.stageCount ?? 0);
              }, 0);

              return (
                <tr key={archetype} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    <span className={cn("inline-flex items-center gap-1", color)}>
                      <Icon className="w-3 h-3 flex-none" aria-hidden="true" />
                      <span className="hidden sm:inline">{label}</span>
                      <span className="sm:hidden">{shortLabel}</span>
                      <span
                        className={cn("text-xs", stageCount <= 2 ? "text-amber-500" : "text-muted-foreground")}
                        title={stageCount <= 2 ? `Only ${stageCount} stage${stageCount === 1 ? "" : "s"} — interpret with caution` : undefined}
                      >({stageCount})</span>
                    </span>
                  </td>
                  {competitors.map((comp) => {
                    const perf = archetypePerformance[comp.id]?.find((p) => p.archetype === archetype);
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

      <ArchetypeGapHighlight data={data} colorMap={colorMap} />
    </div>
  );
}

/** Highlights strongest vs weakest archetype gap per competitor. */
function ArchetypeGapHighlight({ data, colorMap }: { data: CompareResponse; colorMap: Record<number, string> }) {
  const { competitors, archetypePerformance } = data;
  if (!archetypePerformance) return null;

  const highlights: { name: string; color: string; strongest: string; weakest: string; gap: number }[] = [];

  for (const comp of competitors) {
    const perfs = archetypePerformance[comp.id];
    if (!perfs || perfs.length < 2) continue;

    const withPct = perfs.filter((p) => p.avgGroupPercent != null);
    if (withPct.length < 2) continue;

    const sorted = [...withPct].sort((a, b) => (b.avgGroupPercent ?? 0) - (a.avgGroupPercent ?? 0));
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const gap = (strongest.avgGroupPercent ?? 0) - (weakest.avgGroupPercent ?? 0);

    if (gap >= 3) {
      highlights.push({
        name: comp.name.split(" ")[0],
        color: colorMap[comp.id],
        strongest: ARCHETYPE_DISPLAY[strongest.archetype].label.toLowerCase(),
        weakest: ARCHETYPE_DISPLAY[weakest.archetype].label.toLowerCase(),
        gap,
      });
    }
  }

  if (highlights.length === 0) return null;

  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      {highlights.map((h) => (
        <p key={h.name}>
          <span style={{ color: h.color }} className="font-medium">{h.name}</span>
          {" "}strongest on {h.strongest}, weakest on {h.weakest} ({formatPct(h.gap)} gap)
        </p>
      ))}
    </div>
  );
}
