"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  usePlotArea,
  useXAxisDomain,
  useYAxisDomain,
} from "recharts";
import { buildColorMap } from "@/lib/colors";
import { computeIsoHfLines, buildScatterData } from "@/lib/scatter-utils";
import type { ScatterPoint } from "@/lib/scatter-utils";
import type { CompareResponse } from "@/lib/types";

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
        backgroundColor: "hsl(var(--popover))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{pt.competitorName}</p>
      <p style={{ color: "hsl(var(--muted-foreground))", marginBottom: 6 }}>
        Stage {pt.stageNum}: {pt.stageName}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          columnGap: 12,
        }}
      >
        <span style={{ color: "hsl(var(--muted-foreground))" }}>Time</span>
        <span>{pt.time.toFixed(2)} s</span>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>Points</span>
        <span>{pt.points}</span>
        <span style={{ color: "hsl(var(--muted-foreground))" }}>HF</span>
        <span>{pt.hitFactor.toFixed(4)}</span>
      </div>
    </div>
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
        const labelX = px2 <= plotArea.x + plotArea.width - 20 ? px2 + 4 : px2 - 24;
        const labelY = py2 >= plotArea.y + 12 ? py2 - 4 : py2 + 12;

        return (
          <g key={hf}>
            <line
              x1={px1}
              y1={py1}
              x2={px2}
              y2={py2}
              style={{
                stroke: "hsl(var(--muted-foreground))",
                strokeDasharray: "4 3",
                strokeWidth: 1,
                opacity: 0.4,
              }}
            />
            <text
              x={labelX}
              y={labelY}
              style={{
                fontSize: 9,
                fill: "hsl(var(--muted-foreground))",
                opacity: 0.65,
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
// Main component
// --------------------------------------------------------------------------

interface SpeedAccuracyChartProps {
  data: CompareResponse;
}

export function SpeedAccuracyChart({ data }: SpeedAccuracyChartProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const dataByCompetitor = buildScatterData(stages, competitors);

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

  const formatLabel = (id: number) => {
    const comp = competitors.find((c) => c.id === id);
    return comp
      ? `#${comp.competitor_number} ${comp.name.split(" ")[0]}`
      : String(id);
  };

  return (
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
            style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
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
            style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
          }}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        <Legend />
        {/* Iso-HF reference lines — rendered inside chart SVG via Recharts 3 direct children */}
        <IsoHfLinesOverlay />
        {competitors.map((comp) => (
          <Scatter
            key={comp.id}
            name={formatLabel(comp.id)}
            data={dataByCompetitor[comp.id]}
            fill={colorMap[comp.id]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
