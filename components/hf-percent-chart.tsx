"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse, StageComparison } from "@/lib/types";
import { computeHfPct, type RefMode } from "@/lib/hf-percent-utils";

interface HfPercentChartProps {
  data: CompareResponse;
  stages?: StageComparison[];
}

export function HfPercentChart({ data, stages: stagesProp }: HfPercentChartProps) {
  const stages = stagesProp ?? data.stages;
  const { competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [refMode, setRefMode] = useState<RefMode>("stage_winner");

  const chartData = stages.map((stage) => {
    const row: Record<string, string | number | null> = {
      name: `S${stage.stage_num}`,
    };
    for (const comp of competitors) {
      row[`hfpct_${comp.id}`] = computeHfPct(stage, comp.id, refMode);
    }
    return row;
  });

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

  return (
    <div>
      {/* Reference mode selector */}
      <div role="group" aria-label="Reference competitor" className="flex flex-wrap gap-2 pb-3">
        <span className="self-center text-xs text-muted-foreground">vs:</span>
        <button
          type="button"
          onClick={() => setRefMode("stage_winner")}
          aria-pressed={refMode === "stage_winner"}
          className="rounded-full border px-3 text-sm transition-opacity"
          style={{
            borderColor:
              refMode === "stage_winner" ? "var(--muted-foreground)55" : "transparent",
            backgroundColor:
              refMode === "stage_winner" ? "var(--muted-foreground)18" : undefined,
            opacity: refMode === "stage_winner" ? undefined : 0.5,
          }}
        >
          Stage winner
        </button>
        {competitors.map((comp) => {
          const active = refMode === comp.id;
          const color = colorMap[comp.id];
          return (
            <button
              key={comp.id}
              type="button"
              onClick={() => setRefMode(comp.id)}
              aria-pressed={active}
              className="flex items-center gap-2 rounded-full border px-3 text-sm transition-opacity"
              style={{
                borderColor: active ? color + "55" : "transparent",
                backgroundColor: active ? color + "18" : undefined,
                opacity: active ? undefined : 0.5,
              }}
            >
              <span
                className="inline-block h-2.5 w-2.5 flex-none rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              {formatLabel(comp.id)}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          {/* Colored performance bands — rendered first to sit below grid and lines */}
          <ReferenceArea y1={0} y2={85} style={{ fill: "var(--perf-red)" }} fillOpacity={0.07} />
          <ReferenceArea y1={85} y2={95} style={{ fill: "var(--perf-amber)" }} fillOpacity={0.07} />
          <ReferenceArea y1={95} y2={300} style={{ fill: "var(--perf-green)" }} fillOpacity={0.07} />

          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            domain={[0, (dataMax: number) => Math.max(115, Math.ceil(dataMax / 5) * 5 + 5)]}
            tickFormatter={(v: number) => `${v}%`}
            label={{
              value: "HF%",
              angle: -90,
              position: "insideLeft",
              offset: 10,
              style: { fontSize: 11, fill: "var(--muted-foreground)" },
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
              boxShadow: "0 4px 16px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08)",
            }}
            labelStyle={{ color: "var(--popover-foreground)", fontWeight: 600 }}
            itemStyle={{ color: "var(--popover-foreground)" }}
            cursor={{ stroke: "var(--muted-foreground)", opacity: 0.2 }}
            formatter={(value, name) => {
              const id = parseInt(String(name ?? "").replace("hfpct_", ""), 10);
              return [
                typeof value === "number" ? `${value.toFixed(1)}%` : "—",
                formatLabel(id),
              ];
            }}
          />
          <ReferenceLine
            y={100}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{
              value: "100%",
              position: "right",
              style: { fontSize: 10, fill: "var(--muted-foreground)" },
            }}
          />
          {competitors.map((comp) => {
            if (hiddenIds.has(comp.id)) return null;
            return (
              <Line
                key={comp.id}
                type="monotone"
                dataKey={`hfpct_${comp.id}`}
                stroke={colorMap[comp.id]}
                strokeWidth={2}
                dot={{ r: 3, fill: colorMap[comp.id] }}
                activeDot={{ r: 5 }}
                name={`hfpct_${comp.id}`}
                connectNulls={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      {/* Band legend */}
      <div
        className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1 text-xs"
        aria-label="Performance bands"
      >
        <span className="text-green-600 dark:text-green-400">
          <span aria-hidden="true">■</span> &gt;95% solid
        </span>
        <span className="text-amber-600 dark:text-amber-400">
          <span aria-hidden="true">■</span> 85–95% mediocre
        </span>
        <span className="text-red-600 dark:text-red-400">
          <span aria-hidden="true">■</span> &lt;85% leak
        </span>
      </div>

      {/* Series visibility legend */}
      <div
        role="group"
        aria-label="Chart series visibility"
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
