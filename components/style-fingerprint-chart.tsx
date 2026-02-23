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
import type {
  CompareResponse,
  CompetitorInfo,
  StyleFingerprintStats,
  FieldFingerprintPoint,
} from "@/lib/types";

// --------------------------------------------------------------------------
// Cohort filter
// --------------------------------------------------------------------------

type CohortMode = "all" | "division" | "off";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface FingerprintPoint {
  alphaRatio: number;
  pointsPerSecond: number;
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

/** Map penalty rate [0, maxRate] to dot radius [8, 22] px. */
function penaltyToRadius(rate: number, maxRate: number): number {
  if (maxRate <= 0) return 10;
  const norm = Math.min(rate / maxRate, 1);
  return 8 + norm * 14;
}

function buildSelectedPoints(
  competitors: CompetitorInfo[],
  stats: Record<number, StyleFingerprintStats>
): FingerprintPoint[] {
  const valid = competitors
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
        dotRadius: 0,
      };
    })
    .filter((p): p is FingerprintPoint => p !== null);

  const maxRate = Math.max(...valid.map((p) => p.penaltyRate), 0);
  return valid.map((p) => ({ ...p, dotRadius: penaltyToRadius(p.penaltyRate, maxRate) }));
}

/**
 * Filter field points to the given cohort mode.
 * "division" keeps only competitors whose division matches any selected competitor's division.
 */
function filterFieldPoints(
  points: FieldFingerprintPoint[],
  mode: CohortMode,
  selectedCompetitors: CompetitorInfo[],
  styleFingerprintStats: Record<number, StyleFingerprintStats>,
  selectedIds: Set<number>
): FieldFingerprintPoint[] {
  if (mode === "off") return [];

  // Exclude the selected competitors from the background cloud (they get their own dots)
  const field = points.filter((p) => !selectedIds.has(p.competitorId));

  if (mode === "all") return field;

  // "division": keep only those sharing a division with any selected competitor
  // Division comes from the styleFingerprintStats data — we get it from the field points
  // by looking at which divisions the selected competitors belong to.
  // The selected competitors' division info is on their CompetitorInfo.
  const selectedDivisions = new Set(
    selectedCompetitors
      .map((c) => c.division?.toLowerCase().trim())
      .filter((d): d is string => d != null && d !== "")
  );

  if (selectedDivisions.size === 0) return field; // fall back to all when no division info

  return field.filter((p) => {
    const div = p.division?.toLowerCase().trim();
    return div != null && selectedDivisions.has(div);
  });
}

// --------------------------------------------------------------------------
// Quadrant label + crosshair overlay
// (crosshair positioned at field medians when available)
// --------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

interface QuadrantLabelsProps {
  fieldMedianX: number | null;
  fieldMedianY: number | null;
}

function QuadrantLabels({ fieldMedianX, fieldMedianY }: QuadrantLabelsProps) {
  const plotArea = usePlotArea();
  const xDomain = useXAxisDomain();
  const yDomain = useYAxisDomain();

  if (!plotArea || !xDomain || !yDomain) return null;
  if (xDomain.length < 2 || yDomain.length < 2) return null;

  const xMin = typeof xDomain[0] === "number" ? xDomain[0] : 0;
  const xMax = typeof xDomain[1] === "number" ? xDomain[1] : 1;
  const yMin = typeof yDomain[0] === "number" ? yDomain[0] : 0;
  const yMax = typeof yDomain[1] === "number" ? yDomain[1] : 1;

  if (xMax <= xMin || yMax <= yMin) return null;

  const toPixelX = (v: number) =>
    plotArea.x + ((v - xMin) / (xMax - xMin)) * plotArea.width;
  const toPixelY = (v: number) =>
    plotArea.y + ((yMax - v) / (yMax - yMin)) * plotArea.height;

  // Crosshair position: field medians if available, else visual midpoint
  const crossX = toPixelX(fieldMedianX ?? (xMin + xMax) / 2);
  const crossY = toPixelY(fieldMedianY ?? (yMin + yMax) / 2);

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    opacity: 0.2,
    pointerEvents: "none" as const,
    userSelect: "none" as const,
    letterSpacing: 0.4,
    fill: "var(--foreground)",
  };

  // Centre each label in its quadrant rather than nudging from the crosshair.
  // This keeps labels readable regardless of where the field-median crosshair falls.
  const leftEdge  = plotArea.x;
  const rightEdge = plotArea.x + plotArea.width;
  const topEdge   = plotArea.y;
  const botEdge   = plotArea.y + plotArea.height;

  const qTopY = (topEdge  + crossY) / 2;
  const qBotY = (crossY   + botEdge) / 2;
  const qLeftX  = (leftEdge  + crossX) / 2;
  const qRightX = (crossX    + rightEdge) / 2;

  return (
    <g aria-hidden="true">
      {/* Crosshair lines */}
      <line
        x1={crossX} y1={topEdge}
        x2={crossX} y2={botEdge}
        style={{ stroke: "var(--border)", strokeDasharray: "4 3", strokeWidth: 1, opacity: 0.6 }}
      />
      <line
        x1={leftEdge} y1={crossY}
        x2={rightEdge} y2={crossY}
        style={{ stroke: "var(--border)", strokeDasharray: "4 3", strokeWidth: 1, opacity: 0.6 }}
      />

      {/* Quadrant labels — centred in each quadrant */}
      <text x={qRightX} y={qTopY} textAnchor="middle" style={labelStyle}>IDEAL</text>
      <text x={qLeftX}  y={qTopY} textAnchor="middle" style={labelStyle}>FAST / SLOPPY</text>
      <text x={qRightX} y={qBotY} textAnchor="middle" style={labelStyle}>CONSERVATIVE</text>
      <text x={qLeftX}  y={qBotY} textAnchor="middle" style={labelStyle}>STRUGGLING</text>
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
      <circle cx={cx} cy={cy} r={Math.max(r, 22)} fill="transparent" />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke="white" strokeWidth={1.5} opacity={0.88} />
    </g>
  );
}

// --------------------------------------------------------------------------
// Custom tooltip
// --------------------------------------------------------------------------

interface TooltipEntry { payload: FingerprintPoint }

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;
  const penaltyPct =
    pt.totalRounds > 0 ? ((pt.totalPenalties / pt.totalRounds) * 100).toFixed(1) : "0.0";

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
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 12 }}>
        <span style={{ color: "var(--muted-foreground)" }}>Hit quality (α%)</span>
        <span>{(pt.alphaRatio * 100).toFixed(1)}%</span>
        <span style={{ color: "var(--muted-foreground)" }}>Speed (pts/s)</span>
        <span>{pt.pointsPerSecond.toFixed(2)}</span>
        <span style={{ color: "var(--muted-foreground)" }}>Penalty rate</span>
        <span>{penaltyPct}% ({pt.totalPenalties}/{pt.totalRounds} rds)</span>
        <span style={{ color: "var(--muted-foreground)" }}>Stages fired</span>
        <span>{pt.stagesFired}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Field dot (background cohort cloud) — tiny, no tooltip needed
// --------------------------------------------------------------------------

interface FieldDotProps { cx?: number; cy?: number }

function FieldDot({ cx, cy }: FieldDotProps) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      style={{ fill: "var(--muted-foreground)", opacity: 0.22 }}
    />
  );
}

// --------------------------------------------------------------------------
// Competitor legend
// --------------------------------------------------------------------------

interface LegendItem { id: number; label: string; color: string }

function ToggleLegend({
  items, hiddenIds, onToggle,
}: { items: LegendItem[]; hiddenIds: Set<number>; onToggle: (id: number) => void }) {
  return (
    <div role="group" aria-label="Toggle competitors" className="flex flex-wrap justify-center gap-2 pt-2">
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
            <span className="inline-block h-3 w-3 flex-none rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            <span className={hidden ? "line-through" : ""}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------
// Cohort toggle
// --------------------------------------------------------------------------

const COHORT_OPTIONS: { value: CohortMode; label: string }[] = [
  { value: "all", label: "All competitors" },
  { value: "division", label: "Same division" },
  { value: "off", label: "Off" },
];

function CohortToggle({ mode, onChange }: { mode: CohortMode; onChange: (m: CohortMode) => void }) {
  return (
    <div role="group" aria-label="Field overlay cohort" className="flex gap-1 flex-wrap">
      <span className="text-xs self-center pr-1" style={{ color: "var(--muted-foreground)" }}>
        Field overlay:
      </span>
      {COHORT_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={mode === opt.value}
          className="rounded-full border px-3 py-0.5 text-xs transition-colors"
          style={{
            backgroundColor: mode === opt.value ? "var(--foreground)" : undefined,
            color: mode === opt.value ? "var(--background)" : "var(--muted-foreground)",
            borderColor: mode === opt.value ? "var(--foreground)" : "var(--border)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------

interface StyleFingerprintChartProps {
  data: CompareResponse;
}

export function StyleFingerprintChart({ data }: StyleFingerprintChartProps) {
  const { competitors, styleFingerprintStats, fieldFingerprintPoints } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [cohortMode, setCohortMode] = useState<CohortMode>("all");

  const selectedPoints = buildSelectedPoints(competitors, styleFingerprintStats);
  const selectedIds = new Set(competitors.map((c) => c.id));

  const hasData = selectedPoints.length > 0;
  if (!hasData) {
    return (
      <p className="text-sm text-muted-foreground">
        Not enough scored stages to display the style fingerprint.
      </p>
    );
  }

  const fieldPoints = filterFieldPoints(
    fieldFingerprintPoints,
    cohortMode,
    competitors,
    styleFingerprintStats,
    selectedIds
  );

  // Field medians for crosshair positioning (computed from the full unfiltered field
  // so the reference is always the whole match, not just the visible cohort)
  const allFieldExcludingSelected = fieldFingerprintPoints.filter(
    (p) => !selectedIds.has(p.competitorId)
  );
  const fieldMedianX = median(allFieldExcludingSelected.map((p) => p.alphaRatio));
  const fieldMedianY = median(allFieldExcludingSelected.map((p) => p.pointsPerSecond));

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
    <div className="space-y-3">
      <CohortToggle mode={cohortMode} onChange={setCohortMode} />

      {/* Square chart filling full width on mobile */}
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
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3" }} />

            {/* Quadrant overlay — crosshair at field medians */}
            <QuadrantLabels fieldMedianX={fieldMedianX} fieldMedianY={fieldMedianY} />

            {/* Background cohort cloud */}
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
              if (hiddenIds.has(comp.id)) return null;
              const pts = selectedPoints.filter((p) => p.competitorId === comp.id);
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

      <p className="text-center text-xs" style={{ color: "var(--muted-foreground)" }}>
        Dot size ∝ penalty rate — larger dot = more penalties
        {(fieldMedianX != null || fieldMedianY != null) &&
          " · dashed crosshair = field median"}
      </p>

      <ToggleLegend items={legendItems} hiddenIds={hiddenIds} onToggle={toggleSeries} />
    </div>
  );
}
