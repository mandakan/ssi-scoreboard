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

// Color + pattern pairing — pattern carries the same information as color so the
// bar remains readable under deuteranopia/protanopia and in grayscale print.
// "fill" values are tailwind palette hex; "patternKind" indexes into the SVG
// <defs> generated below.
const ZONE_SEGMENTS = [
  { key: "a" as const, fill: "#22c55e", patternKind: "solid" as const },
  { key: "c" as const, fill: "#facc15", patternKind: "diag-light" as const },
  { key: "d" as const, fill: "#fb923c", patternKind: "diag-dense" as const },
  { key: "m" as const, fill: "#ef4444", patternKind: "cross-hatch" as const },
];

const BAR_WIDTH = 80;
const BAR_HEIGHT = 8;

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

  const total = counts.a + counts.c + counts.d + counts.m;
  const hitText = `${counts.a}A ${counts.c}C ${counts.d}D ${counts.m}M`;
  const penaltyText = hasPenaltyData ? ` · ${ns}NS ${p}P` : "";
  const tooltipText = hitText + penaltyText;

  const showPenalties = hasPenaltyData && (ns > 0 || p > 0);

  const penaltyLabel = [
    ns > 0 ? `${ns}NS` : null,
    p > 0 ? `${p}P` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Pre-compute segment x/width so the render path is purely declarative
  // (avoids the react-hooks/immutability "no reassignment after render" rule).
  const segments = (() => {
    const out: Array<{ key: "a" | "c" | "d" | "m"; x: number; width: number }> = [];
    let offset = 0;
    for (const { key } of ZONE_SEGMENTS) {
      const count = counts[key];
      if (count === 0) continue;
      const width = (count / total) * BAR_WIDTH;
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
          aria-label={`Hit zones: ${tooltipText}`}
          className="flex flex-col items-center gap-0.5 cursor-help"
        >
          {hasHitData &&
            (total === 0 ? (
              <div className="w-20 h-2 rounded-sm bg-muted" />
            ) : (
              <svg
                width={BAR_WIDTH}
                height={BAR_HEIGHT}
                viewBox={`0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`}
                className="rounded-sm overflow-hidden"
                aria-hidden="true"
              >
                <defs>
                  {ZONE_SEGMENTS.map(({ key, fill, patternKind }) => {
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
                          width={4}
                          height={4}
                          patternTransform="rotate(45)"
                        >
                          <rect width={4} height={4} fill={fill} />
                          <line
                            x1={0}
                            y1={0}
                            x2={0}
                            y2={4}
                            stroke="rgba(0,0,0,0.45)"
                            strokeWidth={1}
                          />
                        </pattern>
                      );
                    }
                    if (patternKind === "diag-dense") {
                      return (
                        <pattern
                          key={key}
                          id={id}
                          patternUnits="userSpaceOnUse"
                          width={2}
                          height={2}
                          patternTransform="rotate(45)"
                        >
                          <rect width={2} height={2} fill={fill} />
                          <line
                            x1={0}
                            y1={0}
                            x2={0}
                            y2={2}
                            stroke="rgba(0,0,0,0.55)"
                            strokeWidth={0.8}
                          />
                        </pattern>
                      );
                    }
                    // cross-hatch
                    return (
                      <pattern
                        key={key}
                        id={id}
                        patternUnits="userSpaceOnUse"
                        width={3}
                        height={3}
                      >
                        <rect width={3} height={3} fill={fill} />
                        <path
                          d="M0,3 L3,0 M-1,1 L1,-1 M2,4 L4,2"
                          stroke="rgba(0,0,0,0.7)"
                          strokeWidth={0.8}
                        />
                        <path
                          d="M0,0 L3,3 M-1,2 L1,4 M2,-1 L4,1"
                          stroke="rgba(0,0,0,0.7)"
                          strokeWidth={0.8}
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
          {showPenalties && (
            <span className="text-xs leading-none font-mono text-rose-600 dark:text-rose-400">
              {penaltyLabel}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-mono">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}
