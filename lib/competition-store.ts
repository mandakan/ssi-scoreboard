import type { CompareMode, MatchResponse } from "@/lib/types";

export interface StoredCompetition {
  ct: string;
  id: string;
  name: string;
  venue: string | null;
  date: string | null;
  scoring_completed: number;
  last_visited: number;
}

const RECENT_KEY = "ssi_recent_competitions";
const MAX_RECENT = 20;

/** Custom event dispatched (same-tab) whenever the recents list changes. */
export const RECENTS_CHANGED = "ssi:recents_changed";

/** Custom event dispatched (same-tab) whenever a competitor selection changes. */
export const SELECTION_CHANGED = "ssi:selection_changed";

/** Custom event dispatched (same-tab) whenever a mode override changes. */
export const MODE_CHANGED = "ssi:mode_changed";

function competitorKey(ct: string, id: string): string {
  return `ssi_competitors_${ct}_${id}`;
}

// ---------------------------------------------------------------------------
// Recents — helpers
// ---------------------------------------------------------------------------

export function saveRecentCompetition(
  ct: string,
  id: string,
  match: MatchResponse
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentCompetitions().filter(
      (c) => !(c.ct === ct && c.id === id)
    );
    const entry: StoredCompetition = {
      ct,
      id,
      name: match.name,
      venue: match.venue,
      date: match.date,
      scoring_completed: match.scoring_completed,
      last_visited: Date.now(),
    };
    const updated = [entry, ...existing].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event(RECENTS_CHANGED));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

export function getRecentCompetitions(): StoredCompetition[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredCompetition[];
  } catch {
    return [];
  }
}

export function removeRecentCompetition(ct: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    const updated = getRecentCompetitions().filter(
      (c) => !(c.ct === ct && c.id === id)
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event(RECENTS_CHANGED));
  } catch {
    // ignore
  }
}

/**
 * Subscribe function for useSyncExternalStore.
 * Listens for same-tab events and cross-tab storage events.
 */
export function subscribeRecent(onChange: () => void): () => void {
  window.addEventListener(RECENTS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RECENTS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Stable-reference snapshot cache for recents (avoids infinite re-renders). */
let _recentJson: string | null = null;
let _recentSnapshot: StoredCompetition[] = [];

export function getRecentCompetitionsSnapshot(): StoredCompetition[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(RECENT_KEY);
  if (raw === _recentJson) return _recentSnapshot;
  _recentJson = raw;
  try {
    _recentSnapshot = raw ? (JSON.parse(raw) as StoredCompetition[]) : [];
  } catch {
    _recentSnapshot = [];
  }
  return _recentSnapshot;
}

// ---------------------------------------------------------------------------
// Competitor selection — helpers
// ---------------------------------------------------------------------------

export function saveCompetitorSelection(
  ct: string,
  id: string,
  ids: number[]
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(competitorKey(ct, id), JSON.stringify(ids));
    window.dispatchEvent(
      new CustomEvent(SELECTION_CHANGED, { detail: { ct, id } })
    );
  } catch {
    // ignore
  }
}

export function getCompetitorSelection(ct: string, id: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(competitorKey(ct, id));
    if (!raw) return [];
    return JSON.parse(raw) as number[];
  } catch {
    return [];
  }
}

/** Stable-reference snapshot cache for competitor selections. */
const _selCache = new Map<string, { json: string; ids: number[] }>();

export function getCompetitorSelectionSnapshot(
  ct: string,
  id: string
): number[] {
  if (typeof window === "undefined") return [];
  const key = competitorKey(ct, id);
  const raw = localStorage.getItem(key);
  const cached = _selCache.get(key);
  if (cached && cached.json === (raw ?? "")) return cached.ids;
  let ids: number[] = [];
  try {
    ids = raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    // ignore malformed data
  }
  _selCache.set(key, { json: raw ?? "", ids });
  return ids;
}

// ---------------------------------------------------------------------------
// Mode override — helpers
// ---------------------------------------------------------------------------

function modeKey(ct: string, id: string): string {
  return `ssi_mode_${ct}_${id}`;
}

/** Save a mode override for this match. Pass null to clear (revert to auto). */
export function saveModeOverride(ct: string, id: string, mode: CompareMode | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = modeKey(ct, id);
    if (mode === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, mode);
    }
    window.dispatchEvent(new Event(MODE_CHANGED));
  } catch {
    // ignore
  }
}

/** Stable-reference snapshot cache for mode override. */
const _modeCache = new Map<string, { raw: string | null; mode: CompareMode | null }>();

export function getModeOverrideSnapshot(ct: string, id: string): CompareMode | null {
  if (typeof window === "undefined") return null;
  const key = modeKey(ct, id);
  const raw = localStorage.getItem(key);
  const cached = _modeCache.get(key);
  if (cached && cached.raw === raw) return cached.mode;
  const mode = raw === "live" || raw === "coaching" ? raw : null;
  _modeCache.set(key, { raw, mode });
  return mode;
}

/**
 * Subscribe function for useSyncExternalStore — mode override.
 * Listens for same-tab MODE_CHANGED and cross-tab storage events.
 */
export function subscribeMode(onChange: () => void): () => void {
  window.addEventListener(MODE_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MODE_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}
