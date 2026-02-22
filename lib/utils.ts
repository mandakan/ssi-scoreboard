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
