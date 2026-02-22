import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, Calendar, Target } from "lucide-react";
import type { MatchResponse } from "@/lib/types";

interface MatchHeaderProps {
  match: MatchResponse;
}

const LEVEL_LABELS: Record<string, string> = {
  l1: "Level I",
  l2: "Level II",
  l3: "Level III",
  l4: "Level IV",
  l5: "Level V",
};

const SUBRULE_LABELS: Record<string, string> = {
  nm: "Standard",
  pcc: "PCC",
  shotgun: "Shotgun",
  rifle: "Rifle",
};

export function MatchHeader({ match }: MatchHeaderProps) {
  const dateStr = match.date
    ? new Date(match.date).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const pct = match.scoring_completed ?? 0;
  const isComplete = pct >= 100;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <h1 className="text-xl sm:text-2xl font-bold flex-1 min-w-0">{match.name}</h1>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {match.level && (
            <Badge variant="secondary">
              {LEVEL_LABELS[match.level] ?? match.level.toUpperCase()}
            </Badge>
          )}
          {match.sub_rule && (
            <Badge variant="outline">
              {SUBRULE_LABELS[match.sub_rule] ?? match.sub_rule.toUpperCase()}
            </Badge>
          )}
          {match.region && (
            <Badge variant="outline">{match.region}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        {match.venue && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {match.venue}
          </span>
        )}
        {dateStr && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            {dateStr}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Target className="w-3.5 h-3.5 shrink-0" />
          {match.stages_count} stages · {match.competitors_count} competitors
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Scoring progress</span>
          <span>
            {isComplete ? "Complete" : `${Math.round(pct)}%`}
          </span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>
    </div>
  );
}
