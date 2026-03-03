import type { MyShooterIdentity, TrackedShooter } from "@/lib/types";
import { MAX_COMPETITORS } from "@/lib/constants";

export const MY_SHOOTER_KEY = "ssi-my-shooter";
export const TRACKED_KEY = "ssi-tracked-shooters";

/** Custom event dispatched (same-tab) whenever the identity changes. */
export const IDENTITY_CHANGED = "ssi:identity_changed";

/** Custom event dispatched (same-tab) whenever the tracked list changes. */
export const TRACKED_CHANGED = "ssi:tracked_changed";

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

export function saveMyIdentity(identity: MyShooterIdentity | null): void {
  if (typeof window === "undefined") return;
  try {
    if (identity === null) {
      localStorage.removeItem(MY_SHOOTER_KEY);
    } else {
      localStorage.setItem(MY_SHOOTER_KEY, JSON.stringify(identity));
    }
    window.dispatchEvent(new Event(IDENTITY_CHANGED));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

export function getMyIdentity(): MyShooterIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MY_SHOOTER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MyShooterIdentity;
  } catch {
    return null;
  }
}

/** Stable-reference snapshot cache for identity (avoids infinite re-renders). */
let _identityJson: string | null = null;
let _identitySnapshot: MyShooterIdentity | null = null;

export function getMyIdentitySnapshot(): MyShooterIdentity | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(MY_SHOOTER_KEY);
  if (raw === _identityJson) return _identitySnapshot;
  _identityJson = raw;
  try {
    _identitySnapshot = raw ? (JSON.parse(raw) as MyShooterIdentity) : null;
  } catch {
    _identitySnapshot = null;
  }
  return _identitySnapshot;
}

/**
 * Subscribe function for useSyncExternalStore — identity.
 * Listens for same-tab IDENTITY_CHANGED and cross-tab storage events.
 */
export function subscribeIdentity(onChange: () => void): () => void {
  window.addEventListener(IDENTITY_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(IDENTITY_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// ---------------------------------------------------------------------------
// Tracked shooters helpers
// ---------------------------------------------------------------------------

export function saveTrackedShooters(tracked: TrackedShooter[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify(tracked));
    window.dispatchEvent(new Event(TRACKED_CHANGED));
  } catch {
    // ignore
  }
}

export function getTrackedShooters(): TrackedShooter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRACKED_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TrackedShooter[];
  } catch {
    return [];
  }
}

/** Stable-reference snapshot cache for tracked shooters. */
let _trackedJson: string | null = null;
let _trackedSnapshot: TrackedShooter[] = [];

export function getTrackedShootersSnapshot(): TrackedShooter[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(TRACKED_KEY);
  if (raw === _trackedJson) return _trackedSnapshot;
  _trackedJson = raw;
  try {
    _trackedSnapshot = raw ? (JSON.parse(raw) as TrackedShooter[]) : [];
  } catch {
    _trackedSnapshot = [];
  }
  return _trackedSnapshot;
}

/**
 * Subscribe function for useSyncExternalStore — tracked shooters.
 * Listens for same-tab TRACKED_CHANGED and cross-tab storage events.
 */
export function subscribeTracked(onChange: () => void): () => void {
  window.addEventListener(TRACKED_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TRACKED_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function addTrackedShooter(shooter: TrackedShooter): void {
  if (typeof window === "undefined") return;
  const current = getTrackedShooters();
  if (current.some((t) => t.shooterId === shooter.shooterId)) return;
  if (current.length >= MAX_COMPETITORS) return;
  saveTrackedShooters([...current, shooter]);
}

export function removeTrackedShooter(shooterId: number): void {
  if (typeof window === "undefined") return;
  const current = getTrackedShooters();
  saveTrackedShooters(current.filter((t) => t.shooterId !== shooterId));
}
