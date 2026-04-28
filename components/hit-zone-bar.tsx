import { useId } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HitZoneBarProps {
  aHits: number | null;
  cHits: number | null;
  dHits: number | null;
  misses: number | null;
  noShoots: number | null;
  procedurals: number | null;
}

// Bar carries the "where shots landed" story for hits only — A, C, D.
// Misses are diagnostic exceptions, not part of a proportional accuracy story:
// rendering "1 mike out of 32 hits" as a 2px segment is invisible at any pattern
// density. They move below the bar as discrete pips alongside NS and P.
//
// Color + pattern pairing — pattern carries the same information as color so the
// bar remains readable under deuteranopia/protanopia and in grayscale print.
const BAR_SEGMENTS = [
  { key: "a" as const, fill: "#22c55e", patternKind: "solid" as const },
  { key: "c" as const, fill: "#facc15", patternKind: "diag-light" as const },
  { key: "d" as const, fill: "#fb923c", patternKind: "diag-dense" as const },
];

const BAR_WIDTH = 80;
const BAR_HEIGHT = 12;

// Discrete penalty pips: shape + color + count, repeated per occurrence so the
// reader doesn't have to parse a number for the common 1-3 range. Beyond 3,
// collapse to "shape × N".
const PENALTY_PIP_THRESHOLD = 3;

type PenaltyKind = "m" | "ns" | "p";

interface PenaltyDef {
  key: PenaltyKind;
  label: string; // text used in tooltip / aria
  shape: "square" | "triangle" | "diamond";
}

const PENALTY_DEFS: PenaltyDef[] = [
  { key: "m", label: "M", shape: "square" },
  { key: "ns", label: "NS", shape: "triangle" },
  { key: "p", label: "P", shape: "diamond" },
];

function PenaltyShape({ shape }: { shape: PenaltyDef["shape"] }) {
  // 10px pip, red fill, dark stroke for grayscale/CVD legibility
  const stroke = "rgba(0,0,0,0.55)";
  const fill = "#dc2626"; // red-600
  if (shape === "square") {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <rect
          x={1}
          y={1}
          width={8}
          height={8}
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
        />
      </svg>
    );
  }
  if (shape === "triangle") {
    return (
      <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
        <polygon
          points="5,1 9,9 1,9"
          fill={fill}
          stroke={stroke}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // diamond
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
      <polygon
        points="5,1 9,5 5,9 1,5"
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HitZoneBar({
  aHits,
  cHits,
  dHits,
  misses,
  noShoots,
  procedurals,
}: HitZoneBarProps) {
  const idPrefix = useId();
  const hasHitData =
    aHits !== null || cHits !== null || dHits !== null || misses !== null;
  const hasPenaltyData = noShoots !== null || procedurals !== null;

  if (!hasHitData && !hasPenaltyData) return null;

  const counts = {
    a: aHits ?? 0,
    c: cHits ?? 0,
    d: dHits ?? 0,
    m: misses ?? 0,
  };
  const ns = noShoots ?? 0;
  const p = procedurals ?? 0;

  // Bar normalizes over A+C+D only — M now lives below as a pip.
  const barTotal = counts.a + counts.c + counts.d;
  const hitText = `${counts.a}A ${counts.c}C ${counts.d}D ${counts.m}M`;
  const penaltyText = hasPenaltyData ? ` · ${ns}NS ${p}P` : "";
  // aria-label / single-line label retained for screen-reader continuity
  const ariaLabelText = hitText + penaltyText;

  const totalPenaltyCount = counts.m + ns + p;
  const totalPenaltyPts = totalPenaltyCount * 10;

  const penaltyCounts: Record<PenaltyKind, number> = {
    m: counts.m,
    ns,
    p,
  };
  const visiblePenalties = PENALTY_DEFS.filter(
    (def) => penaltyCounts[def.key] > 0
  );

  // Pre-compute segment x/width so the render path is purely declarative
  // (avoids the react-hooks/immutability "no reassignment after render" rule).
  const segments = (() => {
    const out: Array<{ key: "a" | "c" | "d"; x: number; width: number }> = [];
    if (barTotal === 0) return out;
    let offset = 0;
    for (const { key } of BAR_SEGMENTS) {
      const count = counts[key];
      if (count === 0) continue;
      const width = (count / barTotal) * BAR_WIDTH;
      out.push({ key, x: offset, width });
      offset += width;
    }
    return out;
  })();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          aria-label={`Hit zones: ${ariaLabelText}`}
          className="flex flex-col items-center gap-1 cursor-help"
        >
          {hasHitData &&
            (barTotal === 0 ? (
              <div
                className="rounded-sm bg-muted"
                style={{ width: BAR_WIDTH, height: BAR_HEIGHT }}
              />
            ) : (
              <svg
                width={BAR_WIDTH}
                height={BAR_HEIGHT}
                viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}
                className="rounded-sm overflow-hidden"
                aria-hidden="true"
              >
                <defs>
                  {BAR_SEGMENTS.map(({ key, fill, patternKind }) => {
                    const id = `${idPrefix}-${key}`;
                    if (patternKind === "solid") {
                      return (
                        <pattern
                          key={key}
                          id={id}
                          patternUnits="userSpaceOnUse"
                          width={4}
                          height={4}
                        >
                          <rect width={4} height={4} fill={fill} />
                        </pattern>
                      );
                    }
                    if (patternKind === "diag-light") {
                      return (
                        <pattern
                          key={key}
                          id={id}
                          patternUnits="userSpaceOnUse"
                          width={5}
                          height={5}
                          patternTransform="rotate(45)"
                        >
                          <rect width={5} height={5} fill={fill} />
                          <line
                            x1={0}
                            y1={0}
                            x2={0}
                            y2={5}
                            stroke="rgba(0,0,0,0.5)"
                            strokeWidth={1.2}
                          />
                        </pattern>
                      );
                    }
                    // diag-dense (D)
                    return (
                      <pattern
                        key={key}
                        id={id}
                        patternUnits="userSpaceOnUse"
                        width={3}
                        height={3}
                        patternTransform="rotate(45)"
                      >
                        <rect width={3} height={3} fill={fill} />
                        <line
                          x1={0}
                          y1={0}
                          x2={0}
                          y2={3}
                          stroke="rgba(0,0,0,0.6)"
                          strokeWidth={1}
                        />
                      </pattern>
                    );
                  })}
                </defs>
                {segments.map(({ key, x, width }) => (
                  <rect
                    key={key}
                    x={x}
                    y={0}
                    width={width}
                    height={BAR_HEIGHT}
                    fill={`url(#${idPrefix}-${key})`}
                  />
                ))}
              </svg>
            ))}
          {visiblePenalties.length > 0 && (
            <div
              className="flex items-center gap-1.5 leading-none"
              aria-hidden="true"
            >
              {visiblePenalties.map((def) => {
                const count = penaltyCounts[def.key];
                const useCollapsed = count > PENALTY_PIP_THRESHOLD;
                return (
                  <span
                    key={def.key}
                    className="inline-flex items-center gap-0.5"
                  >
                    {useCollapsed ? (
                      <>
                        <PenaltyShape shape={def.shape} />
                        <span className="text-[10px] font-mono font-semibold text-rose-600 dark:text-rose-400">
                          ×{count}
                        </span>
                      </>
                    ) : (
                      Array.from({ length: count }).map((_, i) => (
                        <PenaltyShape key={i} shape={def.shape} />
                      ))
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-1 max-w-56">
        <div className="font-mono">
          {`${counts.a}A · ${counts.c}C · ${counts.d}D`}
        </div>
        {totalPenaltyCount > 0 && (
          <div className="space-y-0.5 border-t border-border/40 pt-1">
            {counts.m > 0 && (
              <div className="flex items-center gap-1.5 font-mono">
                <PenaltyShape shape="square" />
                <span>{`${counts.m} miss${counts.m > 1 ? "es" : ""} · −${counts.m * 10} pts`}</span>
              </div>
            )}
            {ns > 0 && (
              <div className="flex items-center gap-1.5 font-mono">
                <PenaltyShape shape="triangle" />
                <span>{`${ns} no-shoot${ns > 1 ? "s" : ""} · −${ns * 10} pts`}</span>
              </div>
            )}
            {p > 0 && (
              <div className="flex items-center gap-1.5 font-mono">
                <PenaltyShape shape="diamond" />
                <span>{`${p} procedural${p > 1 ? "s" : ""} · −${p * 10} pts`}</span>
              </div>
            )}
            <div className="font-mono font-semibold pt-0.5">
              {`Total: −${totalPenaltyPts} pts`}
            </div>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
