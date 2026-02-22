"use client";

import { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse } from "@/lib/types";

interface ComparisonChartProps {
  data: CompareResponse;
  showBenchmark?: boolean;
}

export function ComparisonChart({ data, showBenchmark = false }: ComparisonChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [benchmarkVisible, setBenchmarkVisible] = useState(showBenchmark);
  const [medianVisible, setMedianVisible] = useState(false);

  const hasBenchmark = stages.some((s) => s.overall_leader_hf != null);
  const hasMedian = stages.some((s) => s.field_median_hf != null);

  const chartData = stages.map((stage) => {
    const row: Record<string, string | number | null> = {
      name: `S${stage.stage_num}`,
      overall_leader_hf: stage.overall_leader_hf,
      field_median_hf: stage.field_median_hf,
    };
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      const key = `${comp.competitor_number}_${comp.id}`;
      if (!sc || sc.dnf || sc.dq) {
        row[key] = 0;
        row[`${key}_opacity`] = 0.25;
      } else {
        row[key] = sc.hit_factor ?? 0;
        row[`${key}_opacity`] = sc.zeroed ? 0.3 : 1;
      }
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
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            allowDecimals
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{
              value: "Hit Factor",
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
            cursor={{ fill: "var(--muted-foreground)", opacity: 0.08 }}
            formatter={(value: number | undefined, name: string | undefined) => {
              if (name === "overall_leader_hf") {
                return [typeof value === "number" ? value.toFixed(4) : "—", "Field leader"];
              }
              if (name === "field_median_hf") {
                return [typeof value === "number" ? value.toFixed(4) : "—", "Field median"];
              }
              const id = parseInt((name ?? "").split("_").pop() ?? "0", 10);
              return [
                typeof value === "number" ? value.toFixed(4) : "—",
                formatLabel(id),
              ];
            }}
          />
          {benchmarkVisible && hasBenchmark && (
            <Line
              dataKey="overall_leader_hf"
              stroke="var(--muted-foreground)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              legendType="none"
              name="overall_leader_hf"
              connectNulls={false}
            />
          )}
          {medianVisible && hasMedian && (
            <Line
              dataKey="field_median_hf"
              stroke="var(--muted-foreground)"
              strokeDasharray="1 3"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              legendType="none"
              name="field_median_hf"
              connectNulls={false}
            />
          )}
          {competitors.map((comp) => {
            if (hiddenIds.has(comp.id)) return null;
            const key = `${comp.competitor_number}_${comp.id}`;
            return (
              <Bar
                key={comp.id}
                dataKey={key}
                fill={colorMap[comp.id]}
                name={key}
                radius={[3, 3, 0, 0]}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
      <div
        role="group"
        aria-label="Chart legend"
        className="flex flex-wrap justify-center gap-2 pt-2"
      >
        {hasBenchmark && (
          <button
            type="button"
            onClick={() => setBenchmarkVisible((v) => !v)}
            aria-pressed={benchmarkVisible}
            className="flex items-center gap-2 rounded-full border px-3 text-sm transition-opacity"
            style={{
              borderColor: benchmarkVisible ? "var(--muted-foreground)55" : "transparent",
              backgroundColor: benchmarkVisible ? "var(--muted-foreground)18" : undefined,
              opacity: benchmarkVisible ? undefined : 0.4,
            }}
          >
            <span
              className="inline-block w-4"
              style={{ borderTop: "2px dashed var(--muted-foreground)" }}
              aria-hidden="true"
            />
            <span className={benchmarkVisible ? "" : "line-through"}>Field leader</span>
          </button>
        )}
        {hasMedian && (
          <button
            type="button"
            onClick={() => setMedianVisible((v) => !v)}
            aria-pressed={medianVisible}
            className="flex items-center gap-2 rounded-full border px-3 text-sm transition-opacity"
            style={{
              borderColor: medianVisible ? "var(--muted-foreground)55" : "transparent",
              backgroundColor: medianVisible ? "var(--muted-foreground)18" : undefined,
              opacity: medianVisible ? undefined : 0.4,
            }}
          >
            <span
              className="inline-block w-4"
              style={{ borderTop: "2px dotted var(--muted-foreground)" }}
              aria-hidden="true"
            />
            <span className={medianVisible ? "" : "line-through"}>Field median</span>
          </button>
        )}
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
