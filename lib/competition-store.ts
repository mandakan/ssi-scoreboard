import type { MatchResponse, Visibility } from "@/lib/types";
import type { GridRowSource } from "@/lib/live-grid-rows";

export interface StoredCompetition {
  ct: string;
  id: string;
  name: string;
  venue: string | null;
  date: string | null;
  scoring_completed: number;
  last_visited: number;
  /** SSI visibility classification at the time of the last visit. Optional
   *  so older localStorage entries (before this field existed) still parse;
   *  they get re-populated on the next visit. The recents card uses it to
   *  badge non-public matches without re-fetching. */
  visibility?: Visibility | null;
}

const RECENT_KEY = "ssi_recent_competitions";
const MAX_RECENT = 20;

/** Custom event dispatched (same-tab) whenever the recents list changes. */
export const RECENTS_CHANGED = "ssi:recents_changed";

/** Custom event dispatched (same-tab) whenever a competitor selection changes. */
export const SELECTION_CHANGED = "ssi:selection_changed";

// Still dispatched by lib/sync.ts for old payloads carrying modeOverrides; nothing reads ssi_mode_* since the mode toggle was retired.
export const MODE_CHANGED = "ssi:mode_changed";

/** Custom event dispatched (same-tab) when the live-scores opt-in is saved. */
export const SCORES_OPTIN_CHANGED = "ssi:scores_optin_changed";

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
      // Boundary mapping: MatchResponse uses the renamed `scoring_pct`,
      // StoredCompetition keeps `scoring_completed` so existing browser
      // localStorage entries don't lose the field on read.
      scoring_completed: match.scoring_pct,
      last_visited: Date.now(),
      visibility: match.visibility ?? null,
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
// Grid row source -- squad vs tracked, remembered per match
// ---------------------------------------------------------------------------

function gridSourceKey(ct: string, id: string): string {
  return `ssi_gridsource_${ct}_${id}`;
}

export function saveGridSourcePreference(
  ct: string,
  id: string,
  source: GridRowSource,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(gridSourceKey(ct, id), source);
  } catch {
    // ignore
  }
}

export function getGridSourcePreference(ct: string, id: string): GridRowSource {
  if (typeof window === "undefined") return "squad";
  try {
    return localStorage.getItem(gridSourceKey(ct, id)) === "tracked"
      ? "tracked"
      : "squad";
  } catch {
    return "squad";
  }
}

// ---------------------------------------------------------------------------
// Live scores opt-in -- pre-match windows never fetch scorecards on their own
// ---------------------------------------------------------------------------

function scoresOptInKey(ct: string, id: string): string {
  return `ssi_scores_optin_${ct}_${id}`;
}

/** Session-scoped: the user asked to load scores before scoring really began. */
export function getLiveScoresOptIn(ct: string, id: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(scoresOptInKey(ct, id)) === "1";
  } catch {
    return false;
  }
}

export function saveLiveScoresOptIn(ct: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(scoresOptInKey(ct, id), "1");
    window.dispatchEvent(
      new CustomEvent(SCORES_OPTIN_CHANGED, { detail: { ct, id } }),
    );
  } catch {
    // ignore
  }
}
