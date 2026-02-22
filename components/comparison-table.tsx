import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, formatHF, formatTime, formatPct } from "@/lib/utils";
import { buildColorMap } from "@/lib/colors";
import type { CompareResponse, CompetitorSummary } from "@/lib/types";

interface ComparisonTableProps {
  data: CompareResponse;
}

const RANK_COLORS = ["bg-yellow-400", "bg-gray-300", "bg-amber-600"];

function RankBadge({ rank }: { rank: number }) {
  const color = rank <= 3 ? RANK_COLORS[rank - 1] : undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white",
        color ?? "bg-muted-foreground"
      )}
    >
      {rank}
    </span>
  );
}

export function ComparisonTable({ data }: ComparisonTableProps) {
  const { stages, competitors } = data;
  const colorMap = buildColorMap(competitors.map((c) => c.id));

  // Compute totals per competitor
  const totals = competitors.map((comp) => {
    let totalPts = 0;
    let hasFired = false;
    for (const stage of stages) {
      const sc = stage.competitors[comp.id];
      if (sc && !sc.dnf) {
        hasFired = true;
        totalPts += sc.points ?? 0;
      }
    }
    return { id: comp.id, points: hasFired ? totalPts : null };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">
              Stage
            </th>
            {competitors.map((comp) => (
              <th
                key={comp.id}
                className="py-2 px-3 text-center font-medium min-w-28"
                style={{ borderBottom: `3px solid ${colorMap[comp.id]}` }}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <span className="font-mono text-xs text-muted-foreground">
                    #{comp.competitor_number}
                  </span>
                  <span>{comp.name.split(" ")[0]}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr key={stage.stage_id} className="border-b hover:bg-muted/30">
              <td className="py-2 pr-4 font-medium">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    Stage {stage.stage_num}
                  </span>
                  <span className="truncate max-w-32">{stage.stage_name}</span>
                </div>
              </td>
              {competitors.map((comp) => {
                const sc = stage.competitors[comp.id];
                return (
                  <td key={comp.id} className="py-2 px-3 text-center align-top">
                    <StageCell sc={sc} maxPoints={stage.max_points} />
                  </td>
                );
              })}
            </tr>
          ))}

          {/* Totals row */}
          <tr className="border-t-2 font-semibold bg-muted/20">
            <td className="py-2 pr-4">Total</td>
            {totals.map((t) => (
              <td key={t.id} className="py-2 px-3 text-center">
                {t.points != null ? (
                  <span>{t.points.toFixed(0)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StageCell({
  sc,
  maxPoints,
}: {
  sc: CompetitorSummary | undefined;
  maxPoints: number;
}) {
  if (!sc || sc.dnf) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  if (sc.dq) {
    return (
      <Badge variant="destructive" className="text-xs">
        DQ
      </Badge>
    );
  }

  if (sc.zeroed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Badge
              variant="outline"
              className="text-xs border-orange-400 text-orange-600 cursor-help"
            >
              0
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>Stage zeroed</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-center gap-1">
        {sc.group_rank != null && sc.group_rank <= 3 && (
          <RankBadge rank={sc.group_rank} />
        )}
        <span className="font-medium">
          {sc.points != null ? sc.points.toFixed(0) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">/{maxPoints}</span>
      </div>
      <div className="text-xs text-muted-foreground space-x-1">
        <span>{formatHF(sc.hit_factor)}</span>
        <span>·</span>
        <span>{formatTime(sc.time)}</span>
      </div>
      {sc.group_percent != null && (
        <span className="text-xs font-medium text-muted-foreground">
          {formatPct(sc.group_percent)}
        </span>
      )}
    </div>
  );
}
