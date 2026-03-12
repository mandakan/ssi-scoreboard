"use client";

import { useState, useEffect, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudDrizzle,
  Zap,
  Wind,
  Thermometer,
  Droplets,
} from "lucide-react";
import { regionToFlagEmoji } from "@/lib/ipsc-categories";
import type { MatchResponse, CompetitorInfo, MatchWeatherData } from "@/lib/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover";
import { usePreMatchWeatherQuery, usePreMatchBriefQuery } from "@/lib/queries";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Sparkles } from "lucide-react";

interface PreMatchViewProps {
  match: MatchResponse;
  selectedIds: number[];
  trackedShooterIds: Set<number>;
  myShooterId: number | null;
  ct: string;
  id: string;
  aiAvailable: boolean;
}

// ── Stage rotation ────────────────────────────────────────────────────────────

// IPSC standard round-robin rotation.
// For squad number `s` (1-indexed) and round `r` (1-indexed), returns the
// 0-based index into a stages array sorted by stage_number.
function getStageIndex(squadNumber: number, round: number, totalStages: number): number {
  return ((squadNumber - 1) + (round - 1)) % totalStages;
}

// ── Constraint parsing ────────────────────────────────────────────────────────

interface StageConstraints {
  strongHand: boolean;
  weakHand: boolean;
  movingTargets: boolean;
  unloadedStart: boolean;
}

function parseConstraints(procedure: string | null, firearmCondition: string | null): StageConstraints {
  const proc = procedure ?? "";
  const fc = firearmCondition ?? "";
  return {
    strongHand: /strong hand/i.test(proc),
    weakHand: /weak hand/i.test(proc),
    movingTargets: /moving target/i.test(proc),
    unloadedStart: /empty|unloaded/i.test(fc),
  };
}

function ConstraintBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-xs bg-amber-500/15 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded">
      {label}
    </span>
  );
}

// ── Weather card ──────────────────────────────────────────────────────────────

function weatherIcon(code: number | null) {
  if (code == null) return <Cloud className="w-5 h-5" aria-hidden="true" />;
  if (code === 0 || code === 1) return <Sun className="w-5 h-5" aria-hidden="true" />;
  if (code === 2 || code === 3) return <Cloud className="w-5 h-5" aria-hidden="true" />;
  if (code >= 45 && code <= 48) return <Cloud className="w-5 h-5" aria-hidden="true" />;
  if (code >= 51 && code <= 57) return <CloudDrizzle className="w-5 h-5" aria-hidden="true" />;
  if (code >= 61 && code <= 67) return <CloudRain className="w-5 h-5" aria-hidden="true" />;
  if (code >= 71 && code <= 77) return <CloudSnow className="w-5 h-5" aria-hidden="true" />;
  if (code >= 80 && code <= 86) return <CloudRain className="w-5 h-5" aria-hidden="true" />;
  if (code >= 95) return <Zap className="w-5 h-5" aria-hidden="true" />;
  return <Cloud className="w-5 h-5" aria-hidden="true" />;
}

function WeatherCard({ weather }: { weather: MatchWeatherData }) {
  const tempStr =
    weather.tempRange != null
      ? `${Math.round(weather.tempRange[0])}–${Math.round(weather.tempRange[1])}°C`
      : null;
  const windStr =
    weather.windspeedAvg != null
      ? `${weather.windspeedAvg.toFixed(1)} m/s${weather.winddirectionDominant ? ` ${weather.winddirectionDominant}` : ""}${
          weather.windgustMax != null ? `, gusts ${weather.windgustMax.toFixed(1)} m/s` : ""
        }`
      : null;
  const precipStr =
    weather.precipitationTotal != null && weather.precipitationTotal > 0
      ? `${weather.precipitationTotal.toFixed(1)} mm`
      : null;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 className="font-semibold">Match day weather</h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About match day weather"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>Match day weather</PopoverTitle>
              <PopoverDescription>
                Forecast for the match venue on the start date.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>
                Sourced from Open-Meteo (free, no API key). Covers the full
                match day in UTC. Forecast accuracy improves closer to the date.
              </p>
              <p>
                Temperature and precipitation are for the day window (approximately 08:00–18:00 UTC).
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-start gap-3">
        <div className="text-muted-foreground mt-0.5">
          {weatherIcon(weather.weatherCode)}
        </div>
        <div className="space-y-1.5 flex-1">
          {weather.weatherLabel && (
            <p className="text-sm font-medium capitalize">{weather.weatherLabel}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tempStr && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Thermometer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {tempStr}
              </span>
            )}
            {windStr && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Wind className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {windStr}
              </span>
            )}
            {precipStr && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Droplets className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {precipStr}
              </span>
            )}
          </div>
          {weather.elevation != null && (
            <p className="text-xs text-muted-foreground">
              Elevation: {Math.round(weather.elevation)} m
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI pre-match brief ────────────────────────────────────────────────────────

function PreMatchBriefCard({
  ct,
  id,
  shooterId,
}: {
  ct: string;
  id: string;
  shooterId: number | null;
}) {
  const briefQuery = usePreMatchBriefQuery(ct, id, shooterId, true);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
        <h2 className="font-semibold">Pre-match brief</h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              aria-label="About pre-match brief"
            >
              <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72" side="bottom" align="start">
            <PopoverHeader>
              <PopoverTitle>AI pre-match brief</PopoverTitle>
              <PopoverDescription>
                Personalised preparation tips based on this match and your
                history.
              </PopoverDescription>
            </PopoverHeader>
            <div className="text-xs text-muted-foreground space-y-1.5 mt-2">
              <p>
                The brief analyses this match&apos;s stage breakdown (course lengths,
                constraints, total rounds) and compares it against your
                historical performance to surface the most relevant preparation
                focus.
              </p>
              <p>
                Requires AI to be configured and at least one tracked competitor
                selected. Historical context improves as you visit more matches.
              </p>
            </div>
          </PopoverContent>
        </Popover>
        {briefQuery.data && (
          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-ring rounded"
            onClick={() => briefQuery.refetch()}
            aria-label="Refresh pre-match brief"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Refresh
          </button>
        )}
      </div>

      {briefQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
      {briefQuery.isError && (
        <p className="text-sm text-muted-foreground">
          Brief unavailable — AI service may be unreachable.
        </p>
      )}
      {briefQuery.data && (
        <p className="text-sm leading-relaxed">{briefQuery.data.tip}</p>
      )}
    </div>
  );
}

// ── Division field ────────────────────────────────────────────────────────────

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
  const headingId = `div-heading-${division.replace(/\W+/g, "-").toLowerCase()}`;

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

// ── Main component ────────────────────────────────────────────────────────────

export function PreMatchView({
  match,
  selectedIds,
  trackedShooterIds,
  myShooterId,
  ct,
  id,
  aiAvailable,
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

  // Weather forecast — only fetched when venue coordinates are available.
  const matchDate = match.date ? match.date.slice(0, 10) : null;
  const weatherQuery = usePreMatchWeatherQuery(match.lat, match.lng, matchDate);

  // Resolve the best shooterId for the AI brief: prefer identity, then first
  // selected competitor that has a global shooterId.
  const briefShooterId = useMemo(() => {
    if (myShooterId !== null) return myShooterId;
    for (const cId of selectedIds) {
      const c = match.competitors.find((x) => x.id === cId);
      if (c?.shooterId != null) return c.shooterId;
    }
    return null;
  }, [myShooterId, selectedIds, match.competitors]);

  const displayRows = rotation.length > 0
    ? rotation
    : sortedStages.map((s, i) => ({ round: i + 1, stage: s }));

  return (
    <div className="space-y-4">
      {/* AI pre-match brief ----------------------------------------------- */}
      {aiAvailable && briefShooterId !== null && (
        <PreMatchBriefCard ct={ct} id={id} shooterId={briefShooterId} />
      )}

      {/* Weather forecast -------------------------------------------------- */}
      {match.lat != null && match.lng != null && weatherQuery.data && (
        <WeatherCard weather={weatherQuery.data} />
      )}

      {/* Stage rotation / list --------------------------------------------- */}
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
            className="space-y-3"
            aria-label={
              selectedSquadNum !== null
                ? `Stage rotation for Squad ${selectedSquadNum}`
                : "Stage list"
            }
          >
            {displayRows.map(({ round, stage }) => {
              const c = parseConstraints(stage.procedure, stage.firearm_condition);
              const constraintBadges = [
                c.unloadedStart && "Unloaded start",
                c.strongHand && "Strong hand",
                c.weakHand && "Weak hand",
                c.movingTargets && "Moving targets",
              ].filter(Boolean) as string[];

              return (
                <li key={stage.id} className="space-y-1.5">
                  <div className="flex items-center gap-3 text-sm">
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
                  </div>
                  {/* Target breakdown */}
                  {(stage.paper_targets != null || stage.steel_targets != null) && (
                    <div className={`flex gap-2 text-xs text-muted-foreground ${match.squads.length > 0 ? "ml-[4.25rem]" : ""}`}>
                      {stage.paper_targets != null && (
                        <span>{stage.paper_targets}P</span>
                      )}
                      {stage.steel_targets != null && stage.steel_targets > 0 && (
                        <span>{stage.steel_targets}S</span>
                      )}
                    </div>
                  )}
                  {/* Constraint badges */}
                  {constraintBadges.length > 0 && (
                    <div className={`flex flex-wrap gap-1 ${match.squads.length > 0 ? "ml-[4.25rem]" : ""}`}>
                      {constraintBadges.map((label) => (
                        <ConstraintBadge key={label} label={label} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
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
