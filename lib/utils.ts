import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parsed result from a shootnscoreit.com match URL. */
export interface ParsedMatchUrl {
  ct: string; // content_type (e.g. "22" for IPSC matches)
  id: string; // match id
}

const MATCH_URL_RE = /shootnscoreit\.com\/event\/(\d+)\/(\d+)\//;

/**
 * Parses a shootnscoreit.com event URL.
 * Returns null for invalid or unrecognized URLs.
 *
 * @example
 * parseMatchUrl("https://shootnscoreit.com/event/22/26547/")
 * // → { ct: "22", id: "26547" }
 */
export function parseMatchUrl(url: string): ParsedMatchUrl | null {
  const match = MATCH_URL_RE.exec(url);
  if (!match) return null;
  return { ct: match[1], id: match[2] };
}

/** Format a hit_factor number to 2 decimal places, or "—" if null. */
export function formatHF(hf: number | null | undefined): string {
  if (hf == null) return "—";
  return hf.toFixed(2);
}

/** Format a time number to 2 decimal places with "s" suffix, or "—" if null. */
export function formatTime(t: number | null | undefined): string {
  if (t == null) return "—";
  return `${t.toFixed(2)}s`;
}

/** Format a percentage to 1 decimal place with "%" suffix, or "—" if null. */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}

/**
 * Compute the points delta for a competitor vs the group leader on a stage.
 *   - returns null when either value is unavailable (e.g. DNF)
 *   - returns 0 when the competitor IS the leader (tie counts as zero gap)
 *   - returns a negative number for competitors behind the leader
 */
export function computePointsDelta(
  points: number | null,
  groupLeaderPoints: number | null
): number | null {
  if (points == null || groupLeaderPoints == null) return null;
  return points - groupLeaderPoints;
}

/**
 * Format a points delta as "±0.0 pts" (leader/tie), "+X.X pts" (ahead),
 * or "−X.X pts" (behind).  Uses the real minus sign (U+2212) for negative values.
 */
export function formatDelta(delta: number): string {
  if (delta === 0) return "\u00b10.0 pts";
  if (delta > 0) return `+${delta.toFixed(1)} pts`;
  return `\u2212${Math.abs(delta).toFixed(1)} pts`;
}
