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

const ZONE_SEGMENTS = [
  { key: "a" as const, colorClass: "bg-green-500" },
  { key: "c" as const, colorClass: "bg-yellow-400" },
  { key: "d" as const, colorClass: "bg-orange-400" },
  { key: "m" as const, colorClass: "bg-red-500" },
];

export function HitZoneBar({
  aHits,
  cHits,
  dHits,
  misses,
  noShoots,
  procedurals,
}: HitZoneBarProps) {
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
              <div className="flex w-20 h-2 rounded-sm overflow-hidden">
                {ZONE_SEGMENTS.map(({ key, colorClass }) => {
                  const count = counts[key];
                  if (count === 0) return null;
                  return (
                    <div
                      key={key}
                      className={colorClass}
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  );
                })}
              </div>
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
