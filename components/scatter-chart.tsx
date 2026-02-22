"use client";

import { useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  usePlotArea,
  useXAxisDomain,
  useYAxisDomain,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import { computeIsoHfLines, buildScatterData } from "@/lib/scatter-utils";
import type { ScatterPoint } from "@/lib/scatter-utils";
import type { CompareResponse, CompetitorInfo } from "@/lib/types";

// --------------------------------------------------------------------------
// Custom tooltip
// --------------------------------------------------------------------------

interface TooltipEntry {
  payload: ScatterPoint;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;

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
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{pt.competitorName}</p>
      <p style={{ color: "var(--muted-foreground)", marginBottom: 6 }}>
        {pt.stageName}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          columnGap: 12,
        }}
      >
        <span style={{ color: "var(--muted-foreground)" }}>Time</span>
        <span>{pt.time.toFixed(2)} s</span>
        <span style={{ color: "var(--muted-foreground)" }}>Points</span>
        <span>{pt.points}</span>
        <span style={{ color: "var(--muted-foreground)" }}>HF</span>
        <span>{pt.hitFactor.toFixed(4)}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Custom dot: competitor color fill + stage number label inside
// --------------------------------------------------------------------------

interface DotProps {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: ScatterPoint;
}

function StageNumberDot({ cx, cy, fill, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;
  return (
    <g>
      {/* Enlarged transparent touch/click hit area */}
      <circle cx={cx} cy={cy} r={18} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={9}
        fill={fill}
        stroke="white"
        strokeWidth={1.5}
        opacity={0.9}
      />
      <text
        x={cx}
        y={cy + 3.5}
        textAnchor="middle"
        fontSize={8}
        fill="white"
        fontWeight="bold"
        className="pointer-events-none select-none"
      >
        {payload.stageNum}
      </text>
    </g>
  );
}

// --------------------------------------------------------------------------
// Iso-HF reference lines overlay
// Rendered as a direct child of ScatterChart so it sits within the
// Recharts Redux provider context and can use axis hooks.
// --------------------------------------------------------------------------

const DEFAULT_HF_VALUES = [2, 4, 6, 8];

function IsoHfLinesOverlay({
  hfValues = DEFAULT_HF_VALUES,
}: {
  hfValues?: number[];
}) {
  const plotArea = usePlotArea();
  const xDomain = useXAxisDomain();
  const yDomain = useYAxisDomain();

  if (!plotArea || !xDomain || !yDomain) return null;
  if (xDomain.length < 2 || yDomain.length < 2) return null;

  const xMin = typeof xDomain[0] === "number" ? xDomain[0] : 0;
  const xMax = typeof xDomain[1] === "number" ? xDomain[1] : 0;
  const yMin = typeof yDomain[0] === "number" ? yDomain[0] : 0;
  const yMax = typeof yDomain[1] === "number" ? yDomain[1] : 0;

  if (xMax <= xMin || yMax <= yMin) return null;

  const toPixelX = (v: number) =>
    plotArea.x + ((v - xMin) / (xMax - xMin)) * plotArea.width;
  const toPixelY = (v: number) =>
    plotArea.y + ((yMax - v) / (yMax - yMin)) * plotArea.height;

  // Clip lines to the actual axis domain (not just raw data bounds)
  const lines = computeIsoHfLines(xMax, yMax, hfValues);

  return (
    <g aria-hidden="true">
      {lines.map(({ hf, x2, y2 }) => {
        const px1 = toPixelX(0);
        const py1 = toPixelY(0);
        const px2 = toPixelX(x2);
        const py2 = toPixelY(y2);
        // Label sits just beyond the line end; nudge inside bounds if near edge
        const labelX = px2 <= plotArea.x + plotArea.width - 20 ? px2 + 4 : px2 - 28;
        const labelY = py2 >= plotArea.y + 14 ? py2 - 4 : py2 + 14;

        return (
          <g key={hf}>
            <line
              x1={px1}
              y1={py1}
              x2={px2}
              y2={py2}
              style={{
                stroke: "var(--muted-foreground)",
                strokeDasharray: "5 3",
                strokeWidth: 1.5,
                opacity: 0.55,
              }}
            />
            <text
              x={labelX}
              y={labelY}
              style={{
                fontSize: 10,
                fill: "var(--muted-foreground)",
                opacity: 0.8,
                fontWeight: 500,
              }}
            >
              HF {hf}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// --------------------------------------------------------------------------
// Interactive accessible legend
// --------------------------------------------------------------------------

interface LegendItem {
  id: number;
  label: string;
  color: string;
}

function ToggleLegend({
  items,
  hiddenIds,
  onToggle,
}: {
  items: LegendItem[];
  hiddenIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Toggle competitors"
      className="flex flex-wrap justify-center gap-2 pt-2"
    >
      {items.map(({ id, label, color }) => {
        const hidden = hiddenIds.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onToggle(id)}
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
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

interface SpeedAccuracyChartProps {
  data: CompareResponse;
}

export function SpeedAccuracyChart({ data }: SpeedAccuracyChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const dataByCompetitor = buildScatterData(stages, competitors);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const hasData = competitors.some(
    (c) => (dataByCompetitor[c.id]?.length ?? 0) > 0,
  );

  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        No scored stages to display.
      </p>
    );
  }

  const formatLabel = (comp: CompetitorInfo) =>
    `#${comp.competitor_number} ${comp.name.split(" ")[0]}`;

  const toggleSeries = (id: number) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const legendItems: LegendItem[] = competitors.map((comp) => ({
    id: comp.id,
    label: formatLabel(comp),
    color: colorMap[comp.id],
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 16, right: 28, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            dataKey="time"
            name="Time"
            domain={[0, "auto"]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            label={{
              value: "Time (s)",
              position: "insideBottom",
              offset: -10,
              style: { fontSize: 11, fill: "var(--muted-foreground)" },
            }}
          />
          <YAxis
            type="number"
            dataKey="points"
            name="Points"
            domain={[0, "auto"]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            label={{
              value: "Points",
              angle: -90,
              position: "insideLeft",
              offset: 10,
              style: { fontSize: 11, fill: "var(--muted-foreground)" },
            }}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ strokeDasharray: "3 3" }}
          />
          {/* Iso-HF reference lines — rendered inside chart SVG via Recharts 3 direct children */}
          <IsoHfLinesOverlay />
          {competitors.map((comp) =>
            hiddenIds.has(comp.id) ? null : (
              <Scatter
                key={comp.id}
                name={formatLabel(comp)}
                data={dataByCompetitor[comp.id]}
                fill={colorMap[comp.id]}
                shape={(props) => (
                  <StageNumberDot
                    cx={(props as DotProps).cx}
                    cy={(props as DotProps).cy}
                    fill={colorMap[comp.id]}
                    payload={(props as DotProps).payload}
                  />
                )}
              />
            ),
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <ToggleLegend
        items={legendItems}
        hiddenIds={hiddenIds}
        onToggle={toggleSeries}
      />
    </div>
  );
}
