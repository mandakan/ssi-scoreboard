"use client";

import { useState, useMemo } from "react";
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
import type { CompareResponse, CompetitorInfo, StageDegradationPoint } from "@/lib/types";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function linearRegression(
  xs: number[],
  ys: number[]
): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumX2 = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function correlationLabel(r: number): string {
  const abs = Math.abs(r);
  const direction = r < 0 ? "early-squad advantage" : "late-squad advantage";
  if (abs < 0.1) return "no clear shooting-order effect";
  if (abs < 0.3) return `weak ${direction}`;
  if (abs < 0.5) return `moderate ${direction}`;
  return `strong ${direction}`;
}

// --------------------------------------------------------------------------
// Trend line SVG overlay (must be a direct child of ScatterChart)
// --------------------------------------------------------------------------

function TrendLine({
  regression,
  xMin,
  xMax,
}: {
  regression: { slope: number; intercept: number };
  xMin: number;
  xMax: number;
}) {
  const plotArea = usePlotArea();
  const xDomain = useXAxisDomain();
  const yDomain = useYAxisDomain();

  if (!plotArea || !xDomain || !yDomain) return null;
  if (xDomain.length < 2 || yDomain.length < 2) return null;

  const dxMin = typeof xDomain[0] === "number" ? xDomain[0] : xMin;
  const dxMax = typeof xDomain[1] === "number" ? xDomain[1] : xMax;
  const dyMin = typeof yDomain[0] === "number" ? yDomain[0] : 0;
  const dyMax = typeof yDomain[1] === "number" ? yDomain[1] : 100;

  if (dxMax <= dxMin || dyMax <= dyMin) return null;

  const toPixelX = (v: number) =>
    plotArea.x + ((v - dxMin) / (dxMax - dxMin)) * plotArea.width;
  const toPixelY = (v: number) =>
    plotArea.y + ((dyMax - v) / (dyMax - dyMin)) * plotArea.height;

  const clampY = (v: number) => Math.max(dyMin, Math.min(dyMax, v));

  const y1 = regression.slope * dxMin + regression.intercept;
  const y2 = regression.slope * dxMax + regression.intercept;

  return (
    <line
      x1={toPixelX(dxMin)}
      y1={toPixelY(clampY(y1))}
      x2={toPixelX(dxMax)}
      y2={toPixelY(clampY(y2))}
      style={{
        stroke: "var(--muted-foreground)",
        strokeDasharray: "6 3",
        strokeWidth: 1.5,
        opacity: 0.6,
      }}
      aria-hidden="true"
    />
  );
}

// --------------------------------------------------------------------------
// Custom dots
// --------------------------------------------------------------------------

interface FieldDotProps {
  cx?: number;
  cy?: number;
}

function FieldDot({ cx, cy }: FieldDotProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      style={{ fill: "var(--muted-foreground)", opacity: 0.2 }}
    />
  );
}

interface SelectedDotProps {
  cx?: number;
  cy?: number;
  fill?: string;
}

function SelectedDot({ cx, cy, fill }: SelectedDotProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <g>
      {/* Enlarged touch target */}
      <circle cx={cx} cy={cy} r={18} fill="transparent" />
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={fill}
        style={{ stroke: "var(--background)" }}
        strokeWidth={1.5}
        opacity={0.9}
      />
    </g>
  );
}

// --------------------------------------------------------------------------
// Custom tooltip
// --------------------------------------------------------------------------

interface TooltipPoint {
  competitorId: number;
  competitorName: string;
  shootingPosition: number;
  hfPercent: number;
}

interface TooltipEntry {
  payload: TooltipPoint;
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
  if (!pt.competitorName) return null;

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
        style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12 }}
      >
        <span style={{ color: "var(--muted-foreground)" }}>Shooting position</span>
        <span>
          {pt.shootingPosition}
        </span>
        <span style={{ color: "var(--muted-foreground)" }}>HF %</span>
        <span>{pt.hfPercent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

interface StageDegradationChartProps {
  data: CompareResponse;
}

export function StageDegradationChart({ data }: StageDegradationChartProps) {
  const { competitors, stageDegradationData } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const selectedIds = useMemo(
    () => new Set(competitors.map((c) => c.id)),
    [competitors]
  );

  const stagesWithData = useMemo(
    () => (stageDegradationData ?? []).filter((s) => s.points.length >= 2),
    [stageDegradationData]
  );

  const [selectedStageId, setSelectedStageId] = useState<number | null>(
    stagesWithData[0]?.stageId ?? null
  );

  // Keep selection valid if stagesWithData changes
  const activeStageId =
    selectedStageId !== null &&
    stagesWithData.some((s) => s.stageId === selectedStageId)
      ? selectedStageId
      : (stagesWithData[0]?.stageId ?? null);

  const stage = stagesWithData.find((s) => s.stageId === activeStageId) ?? null;

  if (!stageDegradationData || stagesWithData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No shooting-order data available — scorecard timestamps are required.
      </p>
    );
  }

  const formatLabel = (comp: CompetitorInfo) =>
    `#${comp.competitor_number} ${comp.name.split(" ")[0]}`;

  // Split this stage's points into field (faded) and selected (highlighted)
  const allPoints = stage?.points ?? [];
  const fieldPoints = allPoints.filter((p) => !selectedIds.has(p.competitorId));
  const selectedPointsByComp: Record<number, StageDegradationPoint[]> = {};
  for (const comp of competitors) {
    const pts = allPoints.filter((p) => p.competitorId === comp.id);
    if (pts.length > 0) selectedPointsByComp[comp.id] = pts;
  }

  // Build Tooltip-ready data for selected competitors (add name for tooltip)
  function toTooltipPoints(compId: number, pts: StageDegradationPoint[]): TooltipPoint[] {
    const comp = competitors.find((c) => c.id === compId);
    return pts.map((p) => ({
      ...p,
      competitorName: comp ? formatLabel(comp) : String(compId),
    }));
  }

  // Linear regression for trend line
  const xs = allPoints.map((p) => p.shootingPosition);
  const ys = allPoints.map((p) => p.hfPercent);
  const regression = allPoints.length >= 4 ? linearRegression(xs, ys) : null;
  const xMin = 1;
  const xMax = allPoints.length;

  return (
    <div className="space-y-3">
      {/* Stage selector */}
      <div
        role="group"
        aria-label="Select stage for degradation view"
        className="flex gap-1.5 flex-wrap"
      >
        {stagesWithData.map((s) => {
          const active = s.stageId === activeStageId;
          return (
            <button
              key={s.stageId}
              type="button"
              onClick={() => setSelectedStageId(s.stageId)}
              aria-pressed={active}
              className="rounded-full border px-3 py-0.5 text-xs transition-colors"
              style={{
                backgroundColor: active ? "var(--foreground)" : undefined,
                color: active ? "var(--background)" : "var(--muted-foreground)",
                borderColor: active ? "var(--foreground)" : "var(--border)",
              }}
            >
              S{s.stageNum}
            </button>
          );
        })}
      </div>

      {/* Correlation badge */}
      {stage && stage.spearmanR !== null && (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Spearman r ={" "}
          <strong>
            {stage.spearmanR > 0 ? "+" : ""}
            {stage.spearmanR.toFixed(2)}
          </strong>
          {" · "}
          {correlationLabel(stage.spearmanR)}
        </p>
      )}
      {stage && stage.spearmanR === null && stage.points.length >= 2 && (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          {stage.points.length} shooter{stage.points.length !== 1 ? "s" : ""} — need ≥ 4 for
          correlation.
        </p>
      )}

      {/* Scatter chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 12, right: 16, left: 0, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            dataKey="shootingPosition"
            name="Shooting position"
            domain={[xMin, xMax]}
            allowDataOverflow
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            label={{
              value: "Shooting position",
              position: "insideBottom",
              offset: -14,
              style: { fontSize: 11, fill: "var(--muted-foreground)" },
            }}
          />
          <YAxis
            type="number"
            dataKey="hfPercent"
            name="HF %"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
            label={{
              value: "HF %",
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

          {/* Trend line overlay */}
          {regression && (
            <TrendLine regression={regression} xMin={xMin} xMax={xMax} />
          )}

          {/* Full-field background dots */}
          {fieldPoints.length > 0 && (
            <Scatter
              name="Field"
              data={fieldPoints}
              shape={(props) => (
                <FieldDot
                  cx={(props as FieldDotProps).cx}
                  cy={(props as FieldDotProps).cy}
                />
              )}
              isAnimationActive={false}
            />
          )}

          {/* Selected competitors */}
          {competitors.map((comp) => {
            const pts = selectedPointsByComp[comp.id];
            if (!pts) return null;
            return (
              <Scatter
                key={comp.id}
                name={formatLabel(comp)}
                data={toTooltipPoints(comp.id, pts)}
                fill={colorMap[comp.id]}
                shape={(props) => (
                  <SelectedDot
                    cx={(props as SelectedDotProps).cx}
                    cy={(props as SelectedDotProps).cy}
                    fill={colorMap[comp.id]}
                  />
                )}
              />
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>

      {/* Competitor legend */}
      <div className="flex flex-wrap justify-center gap-3">
        {competitors.map((comp) => {
          const pt = allPoints.find((p) => p.competitorId === comp.id);
          return (
            <div key={comp.id} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full flex-none"
                style={{ backgroundColor: colorMap[comp.id] }}
                aria-hidden="true"
              />
              <span>{formatLabel(comp)}</span>
              {pt && (
                <span style={{ color: "var(--muted-foreground)" }}>
                  pos.{pt.shootingPosition}, {pt.hfPercent.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
        Faded dots = full field · dashed line = linear trend · position = order shot this stage
      </p>
    </div>
  );
}
