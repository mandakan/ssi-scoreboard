"use client";

import { createElement, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Flame,
  Moon,
  Shield,
  Sun,
  Sunrise,
  Sunset,
  Wind,
  Zap,
} from "lucide-react";
import type { StageClassification, StageConditions } from "@/lib/types";

export function ordinal(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export const RANK_COLORS = ["bg-yellow-400", "bg-gray-300", "bg-amber-600"];

export const CLASSIFICATION_CONFIG: Record<
  StageClassification,
  { label: string; color: string; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
> = {
  solid: { label: "Solid", color: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  conservative: { label: "Conservative", color: "text-yellow-600 dark:text-yellow-400", Icon: Shield },
  "over-push": { label: "Over-push", color: "text-orange-600 dark:text-orange-400", Icon: Zap },
  meltdown: { label: "Meltdown", color: "text-red-600 dark:text-red-400", Icon: Flame },
};

export function RankBadge({
  rank,
  tooltip,
}: {
  rank: number;
  tooltip: string;
}) {
  const color = rank <= 3 ? RANK_COLORS[rank - 1] : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white cursor-help",
            color ?? "bg-muted-foreground"
          )}
        >
          {rank}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export function PenaltyBadge({
  miss,
  noShoots,
  procedurals,
}: {
  miss: number | null;
  noShoots: number | null;
  procedurals: number | null;
}) {
  const m = miss ?? 0;
  const ns = noShoots ?? 0;
  const p = procedurals ?? 0;
  const total = (m + ns + p) * 10;

  if (total === 0) return null;

  const parts: string[] = [];
  if (m > 0) parts.push(`${m} miss (\u2212${m * 10})`);
  if (ns > 0) parts.push(`${ns} no-shoot (\u2212${ns * 10})`);
  if (p > 0) parts.push(`${p} procedural (\u2212${p * 10})`);
  const tooltipText = `${parts.join(" + ")} = \u2212${total} pts`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums cursor-help"
          aria-label={`Penalties: ${tooltipText}`}
        >
          {`\u2212${total}pts`}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

export function ShootingOrderBadge({ order }: { order: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-xs text-muted-foreground/60 tabular-nums cursor-help leading-none"
          aria-label={`Shot this stage ${ordinal(order)} in their rotation`}
        >
          {ordinal(order)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-52 text-center text-xs">
        This was the {ordinal(order)} stage this competitor shot — derived from
        scorecard submission timestamps
      </TooltipContent>
    </Tooltip>
  );
}

export function StageClassificationBadge({
  classification,
  groupPercent,
  aPct,
  miss,
  noShoots,
  procedurals,
}: {
  classification: StageClassification | null;
  groupPercent: number | null;
  aPct: number | null;
  miss: number | null;
  noShoots: number | null;
  procedurals: number | null;
}) {
  if (!classification) return null;
  const { label, color, Icon } = CLASSIFICATION_CONFIG[classification];

  const parts: string[] = [];
  if (groupPercent != null) parts.push(`${groupPercent.toFixed(1)}% HF`);
  if (aPct != null) parts.push(`${aPct.toFixed(0)}% A-zone`);
  const m = miss ?? 0;
  const ns = noShoots ?? 0;
  const proc = procedurals ?? 0;
  if (m + ns + proc > 0) {
    const pen: string[] = [];
    if (m > 0) pen.push(`${m} miss`);
    if (ns > 0) pen.push(`${ns} no-shoot`);
    if (proc > 0) pen.push(`${proc} procedural`);
    parts.push(pen.join(", "));
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex items-center gap-0.5 cursor-help leading-none", color)}
          aria-label={`Run classification: ${label}`}
          role="img"
        >
          <span
            className="w-2 h-2 rounded-full bg-current"
            aria-hidden={true}
          />
          <Icon className="w-3 h-3" aria-hidden={true} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-0.5">
        <div className="font-medium">{label}</div>
        {parts.length > 0 && (
          <div className="text-muted-foreground">{parts.join(" · ")}</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Conditions badge (weather + time-of-day) ──────────────────────────────────

type LucideIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function weatherIcon(code: number | null): LucideIcon {
  if (code == null) return Cloud;
  if (code === 0) return Sun;
  if (code <= 2) return CloudSun;
  if (code === 3) return Cloud;
  if (code <= 48) return CloudFog;
  if (code <= 57) return CloudDrizzle;
  if (code <= 67) return CloudRain;
  if (code <= 77) return CloudSnow;
  if (code <= 82) return CloudRain;
  if (code <= 86) return CloudSnow;
  return CloudLightning;
}

function timeOfDayIcon(hourUtc: number): LucideIcon {
  if (hourUtc >= 4 && hourUtc <= 8) return Sunrise;
  if (hourUtc >= 9 && hourUtc <= 17) return Sun;
  if (hourUtc >= 18 && hourUtc <= 21) return Sunset;
  return Moon;
}

function formatHour(hourUtc: number): string {
  return `${String(hourUtc).padStart(2, "0")}:00 UTC`;
}

/** Returns a Tailwind color class for wind speed intensity (m/s). Null = calm, don't show icon. */
function windColorClass(speedMs: number | null): string | null {
  if (speedMs == null || speedMs < 3) return null;
  if (speedMs < 6)  return "text-sky-400";
  if (speedMs < 10) return "text-amber-500";
  if (speedMs < 15) return "text-orange-500";
  return "text-red-500";
}

/** Small icon cluster showing weather, time-of-day, and wind conditions for a stage cell. */
export function ConditionsBadge({
  hourUtc,
  weatherCode,
  weatherLabel,
  tempC,
  windspeedMs,
  windgustMs,
  winddirectionDominant,
}: StageConditions) {
  const tooltipLines: string[] = [formatHour(hourUtc)];
  if (weatherLabel) tooltipLines.push(weatherLabel);
  if (tempC != null) tooltipLines.push(`${tempC.toFixed(1)}°C`);
  if (windspeedMs != null && windspeedMs >= 3) {
    const dir = winddirectionDominant ? ` ${winddirectionDominant}` : "";
    const gustSuffix =
      windgustMs != null && windgustMs > windspeedMs + 2
        ? ` (gusts ${windgustMs.toFixed(1)} m/s)`
        : "";
    tooltipLines.push(`${windspeedMs.toFixed(1)} m/s${dir}${gustSuffix}`);
  }

  const windColor = windColorClass(windspeedMs);
  const ariaLabel = `Conditions: ${tooltipLines.join(", ")}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-0.5 text-muted-foreground/70 cursor-help leading-none"
          aria-label={ariaLabel}
          role="img"
        >
          {createElement(weatherIcon(weatherCode), { className: "w-3 h-3", "aria-hidden": true })}
          {createElement(timeOfDayIcon(hourUtc), { className: "w-3 h-3", "aria-hidden": true })}
          {windColor != null && (
            // Icon + numeric speed: shape (icon+number vs icon-only vs absent) differentiates
            // tiers independently of color, satisfying WCAG 1.4.1 (use of color).
            <span className={cn("inline-flex items-center gap-px", windColor)} aria-hidden={true}>
              <Wind className="w-3 h-3" />
              <span className="text-[9px] font-medium tabular-nums leading-none">
                {Math.round(windspeedMs!)}
              </span>
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-0.5">
        {tooltipLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
