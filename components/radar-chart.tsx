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
import type { CompareResponse } from "@/lib/types";

interface StageBalanceChartProps {
  data: CompareResponse;
}

export function StageBalanceChart({ data }: StageBalanceChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const radarData = stages.map((stage) => {
    const row: Record<string, string | number> = { stage: `S${stage.stage_num}` };
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      const key = String(comp.id);
      row[key] = !sc || sc.dnf || sc.dq ? 0 : (sc.group_percent ?? 0);
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

  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={radarData} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid className="stroke-border" />
          <PolarAngleAxis
            dataKey="stage"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={{ fontSize: 10 }}
            tickCount={3}
            tickFormatter={(v: number) => `${v}%`}
            className="fill-muted-foreground"
          />
          <Tooltip
            contentStyle={popoverStyle}
            labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
            itemStyle={{ color: "var(--popover-foreground)" }}
            formatter={(value: number | undefined, name: string | undefined) => [
              typeof value === "number" ? `${value.toFixed(1)}%` : "—",
              formatLabel(parseInt(name ?? "0", 10)),
            ]}
          />
          {competitors
            .filter((c) => !hiddenIds.has(c.id))
            .map((comp) => (
              <Radar
                key={comp.id}
                dataKey={String(comp.id)}
                stroke={colorMap[comp.id]}
                fill={colorMap[comp.id]}
                fillOpacity={0.15}
                dot={{ fill: colorMap[comp.id], r: 3 }}
                name={String(comp.id)}
              />
            ))}
        </RadarChart>
      </ResponsiveContainer>
      <div
        role="group"
        aria-label="Toggle competitors"
        className="flex flex-wrap justify-center gap-2 pt-2"
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
