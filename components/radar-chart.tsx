"use client";

import { useState, useEffect } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { buildColorMap, buildShapeMap } from "@/lib/colors";
import {
  CompetitorMarker,
  CompetitorLegendSwatch,
} from "@/components/competitor-marker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CompareResponse, PctMode } from "@/lib/types";

interface StageBalanceChartProps {
  data: CompareResponse;
}

const PCT_MODES: { value: PctMode; label: string; description: string }[] = [
  { value: "group", label: "Group", description: "% of group leader's HF" },
  { value: "overall", label: "Overall", description: "% of field leader's HF" },
];

function getPct(sc: { group_percent: number | null; overall_percent: number | null; div_percent: number | null } | undefined, mode: PctMode): number {
  if (!sc) return 0;
  if (mode === "overall") return sc.overall_percent ?? 0;
  if (mode === "division") return sc.div_percent ?? 0;
  return sc.group_percent ?? 0;
}

export function StageBalanceChart({ data }: StageBalanceChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const shapeMap = buildShapeMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [pctMode, setPctMode] = useState<PctMode>(
    competitors.length < 2 ? "overall" : "group"
  );

  useEffect(() => {
    if (competitors.length < 2 && pctMode === "group") {
      setPctMode("overall");
    } else if (competitors.length >= 2 && pctMode === "overall") {
      setPctMode("group");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to count changes
  }, [competitors.length]);

  const radarData = stages.map((stage) => {
    const row: Record<string, string | number> = { stage: `S${stage.stage_num}` };
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      const key = String(comp.id);
      row[key] = !sc || sc.dnf || sc.dq ? 0 : getPct(sc, pctMode);
    }
    return row;
  });

  const hasData = stages.some((stage) =>
    competitors.some((comp) => {
      const sc = stage.competitors[comp.id];
      return sc && !sc.dnf && !sc.dq && (sc.group_percent ?? 0) > 0;
    }),
  );

  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        No scored stages to display.
      </p>
    );
  }

  const formatLabel = (id: number) => {
    const comp = competitors.find((c) => c.id === id);
    return comp ? `#${comp.competitor_number} ${comp.name.split(" ")[0]}` : String(id);
  };

  const toggleSeries = (id: number) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const popoverStyle = {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
  };

  const currentMode = PCT_MODES.find((m) => m.value === pctMode)!;

  return (
    <div role="img" aria-label="Radar chart showing division position across stage balance dimensions">
      {/* Mode toggle */}
      <ToggleGroup
        type="single"
        value={pctMode}
        onValueChange={(v) => { if (v) setPctMode(v as PctMode); }}
        aria-label="Percent mode"
        className="w-auto flex gap-1 mb-3"
      >
        {PCT_MODES.map((mode) => {
          const active = pctMode === mode.value;
          const disabled = mode.value === "group" && competitors.length < 2;
          return (
            <ToggleGroupItem
              key={mode.value}
              value={mode.value}
              disabled={disabled}
              title={disabled ? "Select 2+ competitors to compare within the group" : mode.description}
              className={[
                "h-auto min-w-0 rounded-full border px-3 py-0.5 text-xs font-medium transition-colors",
                disabled
                  ? "opacity-40 cursor-default text-muted-foreground border-border"
                  : active
                    ? "bg-foreground text-background border-foreground"
                    : "text-muted-foreground border-border hover:border-foreground hover:text-foreground",
              ].join(" ")}
            >
              {mode.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="stage"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          {/* domain fixes the scale at 0–100%; tick=false avoids labels
              overlapping the stage-name ticks around the perimeter */}
          <PolarRadiusAxis domain={[0, 100]} tick={false} />
          <Tooltip
            contentStyle={popoverStyle}
            labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
            itemStyle={{ color: "var(--popover-foreground)" }}
            formatter={(value, name) => [
              typeof value === "number" ? `${value.toFixed(1)}%` : "—",
              formatLabel(typeof name === "number" ? name : parseInt(name ?? "0", 10)),
            ]}
          />
          {competitors
            .filter((c) => !hiddenIds.has(c.id))
            .map((comp) => {
              const color = colorMap[comp.id];
              const shape = shapeMap[comp.id];
              return (
                <Radar
                  key={comp.id}
                  dataKey={String(comp.id)}
                  stroke={color}
                  strokeWidth={2}
                  fill="none"
                  dot={(dotProps) => {
                    const { cx, cy, key } = dotProps as {
                      cx?: number;
                      cy?: number;
                      key?: string | number;
                    };
                    if (cx === undefined || cy === undefined) return <g key={key} />;
                    return (
                      <CompetitorMarker
                        key={key}
                        cx={cx}
                        cy={cy}
                        size={9}
                        fill={color}
                        shape={shape}
                        stroke="var(--background)"
                        strokeWidth={1.5}
                      />
                    );
                  }}
                  name={String(comp.id)}
                />
              );
            })}
        </RadarChart>
      </ResponsiveContainer>

      {/* Context label */}
      <p className="text-center text-xs text-muted-foreground mt-1 mb-2">
        {currentMode.description}
      </p>

      {/* Competitor toggle legend */}
      <div
        role="group"
        aria-label="Toggle competitors"
        className="flex flex-wrap justify-center gap-2"
      >
        {competitors.map((comp) => {
          const hidden = hiddenIds.has(comp.id);
          const label = formatLabel(comp.id);
          const color = colorMap[comp.id];
          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => toggleSeries(comp.id)}
              aria-pressed={!hidden}
              className="flex items-center gap-2 rounded-full border px-3 text-sm transition-opacity"
              style={{
                borderColor: hidden ? "transparent" : color + "55",
                backgroundColor: hidden ? undefined : color + "18",
                opacity: hidden ? 0.4 : undefined,
              }}
            >
              <CompetitorLegendSwatch
                size={12}
                fill={color}
                shape={shapeMap[comp.id]}
              />
              <span className={hidden ? "line-through" : ""}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
