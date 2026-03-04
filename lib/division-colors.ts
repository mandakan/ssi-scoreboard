// Division-to-color mapping for the shooter dashboard.
// Fixed palette for known IPSC divisions, with a deterministic hash fallback
// for unknown divisions. All colors are chosen for WCAG contrast against both
// light and dark backgrounds.

import type { ShooterMatchSummary } from "@/lib/types";

/** Fixed hex color for each known IPSC division. */
const DIVISION_COLOR_MAP: Record<string, string> = {
  "Open Major": "#3b82f6",          // blue-500
  "Open Minor": "#60a5fa",          // blue-400
  "Standard Major": "#22c55e",      // green-500
  "Standard Minor": "#4ade80",      // green-400
  "Production": "#f59e0b",          // amber-500
  "Production Optics": "#f97316",   // orange-500
  "Classic": "#8b5cf6",             // violet-500
  "Revolver": "#ec4899",            // pink-500
  "PCC": "#14b8a6",                 // teal-500
  "Open": "#3b82f6",                // blue-500  (fallback when no power factor)
  "Standard": "#22c55e",            // green-500 (fallback when no power factor)
};

/** Deterministic hash → palette index for unknown divisions. */
const FALLBACK_PALETTE = [
  "#6366f1", // indigo-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
  "#f43f5e", // rose-500
  "#a855f7", // purple-500
  "#0ea5e9", // sky-500
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Returns a hex color for a given division string.
 * Uses the fixed map for known IPSC divisions; falls back to a hash-based
 * palette pick for unknown divisions. Returns a neutral muted color for null.
 */
export function divisionColor(division: string | null): string {
  if (!division) return "#94a3b8"; // slate-400 — neutral muted
  const fixed = DIVISION_COLOR_MAP[division];
  if (fixed) return fixed;
  return FALLBACK_PALETTE[hashString(division) % FALLBACK_PALETTE.length];
}

/**
 * Extracts unique divisions from a list of match summaries,
 * sorted alphabetically.
 */
export function extractDivisions(matches: ShooterMatchSummary[]): string[] {
  const set = new Set<string>();
  for (const m of matches) {
    if (m.division) set.add(m.division);
  }
  return [...set].sort();
}
