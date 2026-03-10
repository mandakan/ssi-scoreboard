// Client-only helpers for collecting and importing localStorage sync data.
// Used by the device sync feature (export on one device, import on another).

import type { SyncPayload, SyncStats } from "@/lib/types";
import {
  MY_SHOOTER_KEY,
  TRACKED_KEY,
  IDENTITY_CHANGED,
  TRACKED_CHANGED,
} from "@/lib/shooter-identity";
import {
  RECENTS_CHANGED,
  SELECTION_CHANGED,
  MODE_CHANGED,
} from "@/lib/competition-store";

const RECENT_KEY = "ssi_recent_competitions";
const FILTERS_KEY = "ssi_event_filters";
const COMPETITORS_PREFIX = "ssi_competitors_";
const MODE_PREFIX = "ssi_mode_";

/** Maximum allowed sync payload size in bytes (50 KB). */
export const MAX_SYNC_PAYLOAD_BYTES = 50_000;

/** Charset for sync codes — no ambiguous chars (0/O, 1/I/L). */
export const SYNC_CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const SYNC_CODE_LENGTH = 6;
export const SYNC_TTL_SECONDS = 300;

/**
 * Collect all sync-worthy data from localStorage into a payload.
 * Returns null if localStorage is unavailable.
 */
export function collectSyncPayload(): SyncPayload | null {
  if (typeof window === "undefined") return null;

  try {
    const identityRaw = localStorage.getItem(MY_SHOOTER_KEY);
    const trackedRaw = localStorage.getItem(TRACKED_KEY);
    const recentRaw = localStorage.getItem(RECENT_KEY);
    const filtersRaw = localStorage.getItem(FILTERS_KEY);

    const competitorSelections: Record<string, number[]> = {};
    const modeOverrides: Record<string, string> = {};

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(COMPETITORS_PREFIX)) {
        try {
          const val = localStorage.getItem(key);
          if (val) competitorSelections[key] = JSON.parse(val) as number[];
        } catch {
          // skip malformed entries
        }
      } else if (key.startsWith(MODE_PREFIX)) {
        const val = localStorage.getItem(key);
        if (val) modeOverrides[key] = val;
      }
    }

    return {
      version: 1,
      identity: identityRaw ? JSON.parse(identityRaw) : null,
      tracked: trackedRaw ? JSON.parse(trackedRaw) : [],
      recentCompetitions: recentRaw ? JSON.parse(recentRaw) : [],
      competitorSelections,
      modeOverrides,
      eventFilters: filtersRaw ? JSON.parse(filtersRaw) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Import a sync payload into localStorage, replacing existing values.
 * Dispatches all relevant custom events so open components update reactively.
 */
export function importSyncPayload(payload: SyncPayload): void {
  if (typeof window === "undefined") return;

  try {
    // Identity
    if (payload.identity) {
      localStorage.setItem(MY_SHOOTER_KEY, JSON.stringify(payload.identity));
    } else {
      localStorage.removeItem(MY_SHOOTER_KEY);
    }

    // Tracked shooters
    localStorage.setItem(TRACKED_KEY, JSON.stringify(payload.tracked));

    // Recent competitions
    localStorage.setItem(RECENT_KEY, JSON.stringify(payload.recentCompetitions));

    // Per-match competitor selections — clear old ones first
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(COMPETITORS_PREFIX) || key?.startsWith(MODE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    // Write new selections
    for (const [key, ids] of Object.entries(payload.competitorSelections)) {
      localStorage.setItem(key, JSON.stringify(ids));
    }

    // Write new mode overrides
    for (const [key, mode] of Object.entries(payload.modeOverrides)) {
      localStorage.setItem(key, mode);
    }

    // Event filters
    if (payload.eventFilters) {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(payload.eventFilters));
    }

    // Dispatch events so all open components re-render
    window.dispatchEvent(new Event(IDENTITY_CHANGED));
    window.dispatchEvent(new Event(TRACKED_CHANGED));
    window.dispatchEvent(new Event(RECENTS_CHANGED));
    window.dispatchEvent(new Event(SELECTION_CHANGED));
    window.dispatchEvent(new Event(MODE_CHANGED));
  } catch {
    // localStorage may be unavailable
  }
}

/** Extract summary stats from a sync payload for the preview UI. */
export function getSyncStats(payload: SyncPayload): SyncStats {
  return {
    hasIdentity: payload.identity !== null,
    trackedCount: payload.tracked.length,
    recentCount: payload.recentCompetitions.length,
    selectionsCount: Object.keys(payload.competitorSelections).length,
  };
}

/** Validate that a value looks like a valid SyncPayload. */
export function isValidSyncPayload(value: unknown): value is SyncPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.version === 1 &&
    Array.isArray(obj.tracked) &&
    Array.isArray(obj.recentCompetitions) &&
    typeof obj.competitorSelections === "object" &&
    obj.competitorSelections !== null &&
    typeof obj.modeOverrides === "object" &&
    obj.modeOverrides !== null
  );
}
