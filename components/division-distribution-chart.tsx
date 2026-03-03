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
  ReferenceLine,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse, DivisionHFDistribution, StageComparison } from "@/lib/types";

interface DivisionDistributionChartProps {
  data: CompareResponse;
  stages?: StageComparison[];
}

// Collect all division keys present in any stage across all selected competitors.
function collectDivisionKeys(data: CompareResponse): string[] {
  const keys = new Set<string>();
  for (const stage of data.stages) {
    for (const comp of data.competitors) {
      const sc = stage.competitors[comp.id];
      if (sc?.divisionKey) keys.add(sc.divisionKey);
    }
  }
  return Array.from(keys).sort();
}

// Find the display label for a division key from a competitor's CompetitorInfo.
// Falls back to the raw key if no match found.
function divisionLabel(divKey: string, data: CompareResponse): string {
  // Find a competitor whose divisionKey matches, then use their formatted division name.
  for (const stage of data.stages) {
    for (const comp of data.competitors) {
      const sc = stage.competitors[comp.id];
      if (sc?.divisionKey === divKey) {
        const info = data.competitors.find((c) => c.id === sc.competitor_id);
        if (info?.division) return info.division;
      }
    }
  }
  return divKey;
}

export function DivisionDistributionChart({ data, stages: stagesProp }: DivisionDistributionChartProps) {
  const stages = stagesProp ?? data.stages;
  const { competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));

  const divisionKeys = collectDivisionKeys(data);
  const [activeDivision, setActiveDivision] = useState<string>(divisionKeys[0] ?? "");

  if (divisionKeys.length === 0 || !activeDivision) {
    return (
      <p className="text-sm text-muted-foreground">
        No division data available for the selected competitors.
      </p>
    );
  }

  // Build chart data: one row per stage
  const chartData = stages.map((stage) => {
    const dist: DivisionHFDistribution | undefined =
      stage.divisionDistributions?.[activeDivision];

    const row: Record<string, string | number | null> = {
      name: `S${stage.stage_num}`,
      // Stacked bar trick: transparent bottom pushes the IQR box up to Q1
      q1_base: dist ? dist.q1Pct : null,
      // IQR box height = Q3 − Q1
      iqr_height: dist ? dist.q3Pct - dist.q1Pct : null,
      // Median as a separate data point for the line
      median_pct: dist ? dist.medianPct : null,
      // Min whisker
      min_pct: dist ? dist.minPct : null,
      // Competitor count for this division on this stage
      div_count: dist ? dist.count : null,
    };

    // Add div_percent for each competitor that belongs to this division
    for (const comp of competitors) {
      const sc = stage.competitors[comp.id];
      if (!sc || sc.divisionKey !== activeDivision) continue;
      const val =
        sc.dnf || sc.dq ? null : (sc.div_percent ?? null);
      row[`comp_${comp.id}`] = val;
    }

    return row;
  });

  const formatLabel = (id: number) => {
    const comp = competitors.find((c) => c.id === id);
    return comp ? `#${comp.competitor_number} ${comp.name.split(" ")[0]}` : String(id);
  };

  // Competitors that belong to the active division (on at least one stage)
  const divisionCompetitors = competitors.filter((comp) =>
    stages.some(
      (s) => s.competitors[comp.id]?.divisionKey === activeDivision
    )
  );

  return (
    <div>
      {/* Division selector — shown only when competitors span multiple divisions */}
      {divisionKeys.length > 1 && (
        <div
          role="group"
          aria-label="Division selector"
          className="flex flex-wrap gap-2 pb-3"
        >
          <span className="self-center text-xs text-muted-foreground">Division:</span>
          {divisionKeys.map((key) => {
            const active = key === activeDivision;
            const label = divisionLabel(key, data);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveDivision(key)}
                aria-pressed={active}
                className="rounded-full border px-3 text-sm transition-opacity"
                style={{
                  borderColor: active ? "var(--muted-foreground)55" : "transparent",
                  backgroundColor: active ? "var(--muted-foreground)18" : undefined,
                  opacity: active ? undefined : 0.5,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
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
            domain={[0, 105]}
            tickFormatter={(v: number) => `${v}%`}
            label={{
              value: "Div HF%",
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
            cursor={{ fill: "var(--muted-foreground)", opacity: 0.06 }}
            formatter={(value: number | undefined, name: string | undefined) => {
              if (name === "q1_base") return [null, null];
              if (name === "div_count") {
                return [
                  typeof value === "number" ? `${value} competitors` : "—",
                  "Field size",
                ];
              }
              if (name === "iqr_height") {
                if (value == null) return ["—", "IQR (Q1–Q3)"];
                return [`${value.toFixed(1)}% wide`, "IQR (Q1–Q3)"];
              }
              if (name === "median_pct") {
                return [
                  typeof value === "number" ? `${value.toFixed(1)}%` : "—",
                  "Division median",
                ];
              }
              if (name === "min_pct") {
                return [
                  typeof value === "number" ? `${value.toFixed(1)}%` : "—",
                  "Division min",
                ];
              }
              if (typeof name === "string" && name.startsWith("comp_")) {
                const id = parseInt(name.replace("comp_", ""), 10);
                return [
                  typeof value === "number" ? `${value.toFixed(1)}%` : "—",
                  formatLabel(id),
                ];
              }
              return [value, name];
            }}
          />

          {/* 100% reference line — the division leader */}
          <ReferenceLine
            y={100}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{
              value: "Leader",
              position: "right",
              style: { fontSize: 10, fill: "var(--muted-foreground)" },
            }}
          />

          {/* Transparent base bar — lifts the IQR box up to Q1 */}
          <Bar
            dataKey="q1_base"
            stackId="dist"
            fill="transparent"
            stroke="none"
            legendType="none"
            isAnimationActive={false}
          />

          {/* IQR box: Q1 to Q3 */}
          <Bar
            dataKey="iqr_height"
            stackId="dist"
            fill="var(--muted-foreground)"
            fillOpacity={0.18}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.35}
            strokeWidth={1}
            radius={[2, 2, 0, 0]}
            legendType="none"
            isAnimationActive={false}
          />

          {/* Division median line — connects median values across stages */}
          <Line
            dataKey="median_pct"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={{ r: 2.5, fill: "var(--muted-foreground)", strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            name="median_pct"
            connectNulls={false}
            legendType="none"
          />

          {/* Division min line — shows the tail of the distribution */}
          <Line
            dataKey="min_pct"
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            strokeOpacity={0.4}
            strokeDasharray="2 4"
            dot={false}
            activeDot={false}
            name="min_pct"
            connectNulls={false}
            legendType="none"
          />

          {/* Hidden line to surface div_count in tooltip */}
          <Line
            dataKey="div_count"
            stroke="none"
            dot={false}
            activeDot={false}
            legendType="none"
            connectNulls={false}
          />

          {/* Competitor div_percent lines */}
          {divisionCompetitors.map((comp) => (
            <Line
              key={comp.id}
              type="monotone"
              dataKey={`comp_${comp.id}`}
              stroke={colorMap[comp.id]}
              strokeWidth={2}
              dot={{ r: 4, fill: colorMap[comp.id], strokeWidth: 0 }}
              activeDot={{ r: 6 }}
              name={`comp_${comp.id}`}
              connectNulls={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="space-y-2 pt-2">
        {/* n range note */}
        {(() => {
          const counts = chartData
            .map((row) => row.div_count)
            .filter((c): c is number => typeof c === "number" && c > 0);
          if (counts.length === 0) return null;
          const minN = Math.min(...counts);
          const maxN = Math.max(...counts);
          return (
            <p className="text-center text-xs text-muted-foreground">
              {minN === maxN ? `n = ${minN} competitors per stage` : `n = ${minN}–${maxN} competitors per stage`}
            </p>
          );
        })()}
        {/* Distribution legend */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-3 rounded-sm border"
              style={{
                backgroundColor: "var(--muted-foreground)",
                opacity: 0.2,
                borderColor: "var(--muted-foreground)",
              }}
              aria-hidden="true"
            />
            Q1–Q3 (middle 50%)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4"
              style={{ borderTop: "2px dashed var(--muted-foreground)" }}
              aria-hidden="true"
            />
            Division median
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4"
              style={{ borderTop: "1px dotted var(--muted-foreground)", opacity: 0.5 }}
              aria-hidden="true"
            />
            Division min
          </span>
        </div>

        {/* Competitor legend */}
        <div
          role="group"
          aria-label="Competitor series"
          className="flex flex-wrap justify-center gap-2"
        >
          {divisionCompetitors.map((comp) => {
            const label = formatLabel(comp.id);
            const color = colorMap[comp.id];
            return (
              <span
                key={comp.id}
                className="flex items-center gap-2 rounded-full border px-3 text-sm"
                style={{ borderColor: color + "55", backgroundColor: color + "18" }}
              >
                <span
                  className="inline-block h-3 w-3 flex-none rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
