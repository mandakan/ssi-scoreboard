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
import type { CompareResponse, CompetitorInfo, StyleFingerprintStats } from "@/lib/types";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface FingerprintPoint {
  alphaRatio: number;
  pointsPerSecond: number;
  /** Normalised penalty rate mapped to a dot radius (px). */
  dotRadius: number;
  penaltyRate: number;
  competitorId: number;
  competitorName: string;
  totalPenalties: number;
  totalRounds: number;
  stagesFired: number;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Map penalty rate to a dot radius in the range [8, 22] px. */
function penaltyToRadius(rate: number, maxRate: number): number {
  if (maxRate <= 0) return 10;
  const norm = Math.min(rate / maxRate, 1);
  return 8 + norm * 14;
}

function buildFingerprintData(
  competitors: CompetitorInfo[],
  stats: Record<number, StyleFingerprintStats>
): FingerprintPoint[] {
  const validPoints = competitors
    .map((c) => {
      const s = stats[c.id];
      if (!s || s.alphaRatio == null || s.pointsPerSecond == null) return null;
      return {
        competitorId: c.id,
        alphaRatio: s.alphaRatio,
        pointsPerSecond: s.pointsPerSecond,
        penaltyRate: s.penaltyRate ?? 0,
        totalPenalties: s.totalPenalties,
        totalRounds: s.totalRounds,
        stagesFired: s.stagesFired,
        competitorName: c.name,
        dotRadius: 0, // filled below after max is known
      };
    })
    .filter((p): p is FingerprintPoint => p !== null);

  const maxRate = Math.max(...validPoints.map((p) => p.penaltyRate), 0);
  return validPoints.map((p) => ({
    ...p,
    dotRadius: penaltyToRadius(p.penaltyRate, maxRate),
  }));
}

// --------------------------------------------------------------------------
// Quadrant label overlay
// --------------------------------------------------------------------------

function QuadrantLabels() {
  const plotArea = usePlotArea();
  const xDomain = useXAxisDomain();
  const yDomain = useYAxisDomain();

  if (!plotArea || !xDomain || !yDomain) return null;
  if (xDomain.length < 2 || yDomain.length < 2) return null;

  const xMid = plotArea.x + plotArea.width / 2;
  const yMid = plotArea.y + plotArea.height / 2;

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.18,
    pointerEvents: "none" as const,
    userSelect: "none" as const,
    letterSpacing: 0.3,
  };

  const pad = 10;

  return (
    <g aria-hidden="true">
      {/* Top-right: Ideal */}
      <text
        x={xMid + pad}
        y={plotArea.y + pad + 12}
        style={{ ...labelStyle, fill: "var(--foreground)" }}
        textAnchor="start"
      >
        IDEAL
      </text>
      {/* Top-left: Fast / sloppy */}
      <text
        x={xMid - pad}
        y={plotArea.y + pad + 12}
        style={{ ...labelStyle, fill: "var(--foreground)" }}
        textAnchor="end"
      >
        FAST / SLOPPY
      </text>
      {/* Bottom-right: Conservative */}
      <text
        x={xMid + pad}
        y={plotArea.y + plotArea.height - pad}
        style={{ ...labelStyle, fill: "var(--foreground)" }}
        textAnchor="start"
      >
        CONSERVATIVE
      </text>
      {/* Bottom-left: Struggling */}
      <text
        x={xMid - pad}
        y={plotArea.y + plotArea.height - pad}
        style={{ ...labelStyle, fill: "var(--foreground)" }}
        textAnchor="end"
      >
        STRUGGLING
      </text>

      {/* Crosshair lines */}
      <line
        x1={xMid}
        y1={plotArea.y}
        x2={xMid}
        y2={plotArea.y + plotArea.height}
        style={{
          stroke: "var(--border)",
          strokeDasharray: "4 3",
          strokeWidth: 1,
          opacity: 0.5,
        }}
      />
      <line
        x1={plotArea.x}
        y1={yMid}
        x2={plotArea.x + plotArea.width}
        y2={yMid}
        style={{
          stroke: "var(--border)",
          strokeDasharray: "4 3",
          strokeWidth: 1,
          opacity: 0.5,
        }}
      />
    </g>
  );
}

// --------------------------------------------------------------------------
// Custom dot — size encodes penalty rate
// --------------------------------------------------------------------------

interface DotProps {
  cx?: number;
  cy?: number;
  fill?: string;
  payload?: FingerprintPoint;
}

function PenaltyDot({ cx, cy, fill, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const r = payload.dotRadius;
  return (
    <g>
      {/* Enlarged transparent touch hit area */}
      <circle cx={cx} cy={cy} r={Math.max(r, 22)} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={fill}
        stroke="white"
        strokeWidth={1.5}
        opacity={0.88}
      />
    </g>
  );
}

// --------------------------------------------------------------------------
// Custom tooltip
// --------------------------------------------------------------------------

interface TooltipEntry {
  payload: FingerprintPoint;
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

  const penaltyPct =
    pt.totalRounds > 0
      ? ((pt.totalPenalties / pt.totalRounds) * 100).toFixed(1)
      : "0.0";

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
      <p style={{ fontWeight: 600, marginBottom: 4 }}>{pt.competitorName}</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          columnGap: 12,
        }}
      >
        <span style={{ color: "var(--muted-foreground)" }}>Hit quality (α%)</span>
        <span>{(pt.alphaRatio * 100).toFixed(1)}%</span>
        <span style={{ color: "var(--muted-foreground)" }}>Speed (pts/s)</span>
        <span>{pt.pointsPerSecond.toFixed(2)}</span>
        <span style={{ color: "var(--muted-foreground)" }}>Penalty rate</span>
        <span>
          {penaltyPct}% ({pt.totalPenalties}/{pt.totalRounds} rds)
        </span>
        <span style={{ color: "var(--muted-foreground)" }}>Stages fired</span>
        <span>{pt.stagesFired}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Legend
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
// Penalty size legend
// --------------------------------------------------------------------------

function PenaltySizeLegend() {
  return (
    <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
      Dot size ∝ penalty rate — larger dot = more penalties
    </p>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

interface StyleFingerprintChartProps {
  data: CompareResponse;
}

export function StyleFingerprintChart({ data }: StyleFingerprintChartProps) {
  const { competitors, styleFingerprintStats } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const allPoints = buildFingerprintData(competitors, styleFingerprintStats);
  const hasData = allPoints.length > 0;

  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough scored stages to display the style fingerprint.
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
      {/* Square chart that fills full width on mobile */}
      <div className="w-full" style={{ aspectRatio: "1 / 1", maxHeight: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, left: 0, bottom: 32 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="alphaRatio"
              name="Hit quality"
              domain={[0, 1]}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontSize: 12 }}
              className="fill-muted-foreground"
              label={{
                value: "Hit quality (α%)",
                position: "insideBottom",
                offset: -16,
                style: { fontSize: 12, fill: "var(--muted-foreground)" },
              }}
            />
            <YAxis
              type="number"
              dataKey="pointsPerSecond"
              name="Speed"
              domain={[0, "auto"]}
              tick={{ fontSize: 12 }}
              className="fill-muted-foreground"
              label={{
                value: "Speed (pts/s)",
                angle: -90,
                position: "insideLeft",
                offset: 10,
                style: { fontSize: 12, fill: "var(--muted-foreground)" },
              }}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ strokeDasharray: "3 3" }}
            />
            {/* Quadrant labels and crosshair lines */}
            <QuadrantLabels />
            {competitors.map((comp) => {
              if (hiddenIds.has(comp.id)) return null;
              const pts = allPoints.filter((p) => p.competitorId === comp.id);
              if (pts.length === 0) return null;
              return (
                <Scatter
                  key={comp.id}
                  name={formatLabel(comp)}
                  data={pts}
                  fill={colorMap[comp.id]}
                  shape={(props) => (
                    <PenaltyDot
                      cx={(props as DotProps).cx}
                      cy={(props as DotProps).cy}
                      fill={colorMap[comp.id]}
                      payload={(props as DotProps).payload}
                    />
                  )}
                />
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <PenaltySizeLegend />
      <ToggleLegend
        items={legendItems}
        hiddenIds={hiddenIds}
        onToggle={toggleSeries}
      />
    </div>
  );
}
