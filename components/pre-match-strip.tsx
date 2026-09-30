"use client";

import Link from "next/link";
import { usePreMatchWeatherQuery } from "@/lib/queries";
import { matchTabHref } from "@/lib/match-routes";
import { squadForShooter, squadRotation } from "@/lib/stage-rotation";
import type { MatchResponse } from "@/lib/types";

interface PreMatchStripProps {
  ct: string;
  id: string;
  match: MatchResponse;
  myShooterId: number | null;
  onShowLiveScores: () => void;
}

/**
 * Slim header above the empty pre-match grid: the user's squad and predicted
 * first stage, a compact forecast, and the opt-in to load live scores.
 * Nothing here calls SSI: the weather query is the same one PreMatchView uses
 * (same key, so tab switches reuse it) and goes to Open-Meteo via our route.
 */
export function PreMatchStrip({
  ct,
  id,
  match,
  myShooterId,
  onShowLiveScores,
}: PreMatchStripProps) {
  const weatherQuery = usePreMatchWeatherQuery(
    match.lat,
    match.lng,
    match.date ? match.date.slice(0, 10) : null,
    match.venue,
    match.region,
  );

  const squad = squadForShooter(match, myShooterId);
  const firstStage = squad
    ? squadRotation(squad.number, match.stages)[0]?.stage.stage_number ?? null
    : null;

  const response = weatherQuery.data;
  const weather = response?.available ? response.weather : null;
  const temp =
    weather?.tempRange != null
      ? `${Math.round(weather.tempRange[0])} to ${Math.round(weather.tempRange[1])}°C`
      : null;
  const weatherText = weather
    ? [weather.weatherLabel, temp].filter(Boolean).join(", ")
    : null;

  return (
    <section
      aria-labelledby="pre-match-strip-heading"
      className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b bg-card px-3 py-2 text-[12px]"
    >
      <h2 id="pre-match-strip-heading" className="sr-only">
        Before scoring
      </h2>
      {squad && (
        <span className="font-medium text-foreground">
          {squad.name}
          {firstStage != null && (
            <span className="text-muted-foreground"> &middot; First stage: {firstStage}</span>
          )}
        </span>
      )}
      {weatherText && <span className="text-muted-foreground">{weatherText}</span>}
      <span className="ml-auto flex items-center gap-2">
        <Link
          href={matchTabHref(ct, id, "info")}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-2 hover:opacity-80"
        >
          Match info
        </Link>
        <button
          type="button"
          onClick={onShowLiveScores}
          className="min-h-11 rounded-md border px-3 font-medium"
        >
          Show live scores
        </button>
      </span>
    </section>
  );
}
