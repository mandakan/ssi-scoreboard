"use client";

import { useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse, StyleFingerprintStats } from "@/lib/types";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

const AXES = ["Speed", "Accuracy", "Composure", "Consistency"] as const;
type Axis = (typeof AXES)[number];

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function getPercentile(stats: StyleFingerprintStats | undefined, axis: Axis): number {
  if (!stats) return 50;
  switch (axis) {
    case "Speed":       return stats.speedPercentile ?? 50;
    case "Accuracy":    return stats.accuracyPercentile ?? 50;
    case "Composure":   return stats.composurePercentile;
    case "Consistency": return stats.consistencyPercentile;
  }
}

// --------------------------------------------------------------------------
// Custom tooltip
// --------------------------------------------------------------------------

const REFERENCE_KEY = "__reference__";

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const filtered = payload.filter((p) => p.name !== REFERENCE_KEY);
  if (filtered.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {filtered.map((entry) => (
        <div key={entry.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--muted-foreground)" }}>{entry.name}:</span>
          <span>{Math.round(entry.value)}th pct.</span>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

interface ShooterStyleRadarChartProps {
  data: CompareResponse;
}

export function ShooterStyleRadarChart({ data }: ShooterStyleRadarChartProps) {
  const { competitors, styleFingerprintStats } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const radarData = AXES.map((axis) => {
    const row: Record<string, string | number> = { axis };
    for (const comp of competitors) {
      const stats = styleFingerprintStats[comp.id];
      row[String(comp.id)] = getPercentile(stats, axis);
    }
    row[REFERENCE_KEY] = 50;
    return row;
  });

  const hasData = competitors.some((c) => styleFingerprintStats[c.id] != null);
  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough scored stages to display the style profile.
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

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tickCount={5}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => String(v)}
          />
          <Tooltip
            content={<CustomTooltip />}
            contentStyle={popoverStyle}
          />

          {/* Reference polygon at field median (50th percentile on all axes) */}
          <Radar
            dataKey={REFERENCE_KEY}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 2"
            strokeWidth={1}
            fill="none"
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />

          {/* Selected competitors */}
          {competitors
            .filter((c) => !hiddenIds.has(c.id))
            .map((comp) => (
              <Radar
                key={comp.id}
                name={formatLabel(comp.id)}
                dataKey={String(comp.id)}
                stroke={colorMap[comp.id]}
                strokeWidth={2}
                fill={colorMap[comp.id]}
                fillOpacity={0.15}
                dot={{ fill: colorMap[comp.id], r: 3, stroke: "var(--background)", strokeWidth: 1 }}
              />
            ))}
        </RadarChart>
      </ResponsiveContainer>

      <p className="text-center text-xs text-muted-foreground mt-1 mb-2">
        Field percentile ranks (0–100) · dashed = field median (50th pct.)
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
              <span
                className="inline-block h-3 w-3 flex-none rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className={hidden ? "line-through" : ""}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
