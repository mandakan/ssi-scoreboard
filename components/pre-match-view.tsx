"use client";

import { useState, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import { regionToFlagEmoji } from "@/lib/ipsc-categories";
import type { MatchResponse, CompetitorInfo } from "@/lib/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";

interface PreMatchViewProps {
  match: MatchResponse;
  selectedIds: number[];
  trackedShooterIds: Set<number>;
  myShooterId: number | null;
}

// IPSC standard round-robin rotation.
// For squad number `s` (1-indexed) and round `r` (1-indexed), returns the
// 0-based index into a stages array sorted by stage_number.
function getStageIndex(squadNumber: number, round: number, totalStages: number): number {
  return ((squadNumber - 1) + (round - 1)) % totalStages;
}

const MAX_COLLAPSED = 5;

function DivisionSection({
  division,
  competitors,
  trackedShooterIds,
  myShooterId,
}: {
  division: string;
  competitors: CompetitorInfo[];
  trackedShooterIds: Set<number>;
  myShooterId: number | null;
}) {
  const hasHighlighted = competitors.some(
    (c) =>
      c.shooterId !== null &&
      (trackedShooterIds.has(c.shooterId) || c.shooterId === myShooterId),
  );
  const [expanded, setExpanded] = useState(hasHighlighted);

  const shown = expanded ? competitors : competitors.slice(0, MAX_COLLAPSED);
  const overflow = competitors.length - MAX_COLLAPSED;
  const headingId = `div-heading-${division.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div>
      <h3>
        <button
          id={headingId}
          className="w-full flex items-center justify-between py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring rounded"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={`${headingId}-panel`}
        >
          <span className="font-medium text-sm">{division}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {competitors.length}
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </span>
        </button>
      </h3>
      <section
        id={`${headingId}-panel`}
        role="region"
        aria-labelledby={headingId}
      >
        <ul className="space-y-0.5 pb-2">
          {shown.map((c) => {
            const isMe = c.shooterId !== null && c.shooterId === myShooterId;
            const isTracked =
              c.shooterId !== null && trackedShooterIds.has(c.shooterId);
            const highlighted = isMe || isTracked;
            const flag = regionToFlagEmoji(c.region);
            return (
              <li
                key={c.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-sm ${
                  highlighted
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <span className="text-xs text-muted-foreground w-7 shrink-0 text-right tabular-nums">
                  #{c.competitor_number}
                </span>
                <span
                  className={`flex-1 truncate ${highlighted ? "font-medium" : ""}`}
                >
                  {c.name}
                </span>
                {c.club && (
                  <span className="text-xs truncate max-w-[80px] hidden sm:inline">
                    {c.club}
                  </span>
                )}
                {flag && (
                  <span aria-label={c.region_display ?? c.region ?? undefined}>
                    {flag}
                  </span>
                )}
                {isMe && (
                  <span className="text-xs text-primary font-semibold shrink-0">
                    you
                  </span>
                )}
              </li>
            );
          })}
          {!expanded && overflow > 0 && (
            <li>
              <button
                className="w-full text-left text-xs text-muted-foreground px-2 py-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring rounded"
                onClick={() => setExpanded(true)}
              >
                + {overflow} more
              </button>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

export function PreMatchView({
  match,
  selectedIds,
  trackedShooterIds,
  myShooterId,
}: PreMatchViewProps) {
  const sortedStages = useMemo(
    () => [...match.stages].sort((a, b) => a.stage_number - b.stage_number),
    [match.stages],
  );

  // Determine which squad to show by default: prefer the squad of a selected
  // or identity competitor, fall back to the first squad.
  const defaultSquadNum = useMemo(() => {
    if (match.squads.length === 0) return null;

    const priorityId =
      selectedIds[0] ??
      (myShooterId !== null
        ? match.competitors.find((c) => c.shooterId === myShooterId)?.id
        : undefined);

    if (priorityId !== undefined) {
      const squad = match.squads.find((s) => s.competitorIds.includes(priorityId));
      if (squad) return squad.number;
    }
    return match.squads[0].number;
  }, [match.squads, match.competitors, selectedIds, myShooterId]);

  const [selectedSquadNum, setSelectedSquadNum] = useState<number | null>(
    defaultSquadNum,
  );

  useEffect(() => {
    setSelectedSquadNum(defaultSquadNum);
  }, [defaultSquadNum]);

  const rotation = useMemo(() => {
    if (selectedSquadNum === null || sortedStages.length === 0) return [];
    const N = sortedStages.length;
    return Array.from({ length: N }, (_, r) => ({
      round: r + 1,
      stage: sortedStages[getStageIndex(selectedSquadNum, r + 1, N)],
    }));
  }, [selectedSquadNum, sortedStages]);

  // Group competitors by division; divisions with tracked shooters sort first.
  const divisionGroups = useMemo(() => {
    const map = new Map<string, CompetitorInfo[]>();
    for (const c of match.competitors) {
      const div = c.division ?? "Unknown division";
      if (!map.has(div)) map.set(div, []);
      map.get(div)!.push(c);
    }
    return [...map.entries()].sort(([, a], [, b]) => {
      const aHit = a.some(
        (c) =>
          c.shooterId !== null &&
          (trackedShooterIds.has(c.shooterId) || c.shooterId === myShooterId),
      );
      const bHit = b.some(
        (c) =>
          c.shooterId !== null &&
          (trackedShooterIds.has(c.shooterId) || c.shooterId === myShooterId),
      );
      if (aHit !== bHit) return aHit ? -1 : 1;
      return b.length - a.length;
    });
  }, [match.competitors, trackedShooterIds, myShooterId]);

  const useSelectControl = match.squads.length > 8;

  return (
    <div className="space-y-4">
      {/* Stage rotation ---------------------------------------------------- */}
      {sortedStages.length > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-1.5">
            <h2 className="font-semibold">Stage rotation</h2>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  aria-label="About stage rotation"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72" side="bottom" align="start">
                <PopoverHeader>
                  <PopoverTitle>Stage rotation</PopoverTitle>
                  <PopoverDescription>
                    Which stage your squad shoots each round.
                  </PopoverDescription>
                </PopoverHeader>
                <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                  <p>
                    IPSC competitions use a round-robin rotation: each squad
                    starts at a different stage and advances by one each round.
                  </p>
                  <p>
                    Select your squad to see your shooting order for the day.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {match.squads.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground shrink-0">
                Your squad:
              </span>
              {useSelectControl ? (
                <select
                  className="text-sm border border-border rounded px-2 py-1 bg-background text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  value={selectedSquadNum ?? ""}
                  onChange={(e) => setSelectedSquadNum(Number(e.target.value))}
                  aria-label="Select squad"
                >
                  {match.squads.map((sq) => (
                    <option key={sq.id} value={sq.number}>
                      {sq.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div
                  className="flex gap-1.5 flex-wrap"
                  role="group"
                  aria-label="Select squad"
                >
                  {match.squads.map((sq) => (
                    <button
                      key={sq.id}
                      onClick={() => setSelectedSquadNum(sq.number)}
                      aria-pressed={selectedSquadNum === sq.number}
                      className={`px-3 py-1 rounded-full text-sm border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
                        selectedSquadNum === sq.number
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                      }`}
                    >
                      {sq.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <ol
            className="space-y-2"
            aria-label={
              selectedSquadNum !== null
                ? `Stage rotation for Squad ${selectedSquadNum}`
                : "Stage list"
            }
          >
            {(rotation.length > 0 ? rotation : sortedStages.map((s, i) => ({ round: i + 1, stage: s }))).map(
              ({ round, stage }) => (
                <li key={stage.id} className="flex items-center gap-3 text-sm">
                  {match.squads.length > 0 && (
                    <span className="text-xs text-muted-foreground w-14 shrink-0 tabular-nums">
                      Round {round}
                    </span>
                  )}
                  <span className="font-medium flex-1 min-w-0 truncate">
                    Stage {stage.stage_number}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      — {stage.name}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {stage.course_display && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {stage.course_display}
                      </span>
                    )}
                    {stage.min_rounds != null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {stage.min_rounds}r
                      </span>
                    )}
                  </div>
                </li>
              ),
            )}
          </ol>
        </div>
      )}

      {/* Registered field -------------------------------------------------- */}
      {divisionGroups.length > 0 && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <h2 className="font-semibold">Registered field</h2>
            <span className="text-xs text-muted-foreground">
              — {match.competitors.length} competitors
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="ml-auto text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  aria-label="About registered field"
                >
                  <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72" side="bottom" align="end">
                <PopoverHeader>
                  <PopoverTitle>Registered field</PopoverTitle>
                  <PopoverDescription>
                    All registered competitors, grouped by division.
                  </PopoverDescription>
                </PopoverHeader>
                <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
                  <p>
                    Competitors you track are highlighted. Divisions with your
                    tracked shooters expand automatically.
                  </p>
                  <p>
                    Tap a division heading to expand or collapse the competitor
                    list.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="divide-y divide-border">
            {divisionGroups.map(([division, competitors]) => (
              <DivisionSection
                key={division}
                division={division}
                competitors={competitors}
                trackedShooterIds={trackedShooterIds}
                myShooterId={myShooterId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
