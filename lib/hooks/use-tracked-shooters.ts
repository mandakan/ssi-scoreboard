"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  subscribeTracked,
  getTrackedShootersSnapshot,
  addTrackedShooter,
  removeTrackedShooter,
} from "@/lib/shooter-identity";
import type { TrackedShooter } from "@/lib/types";

// Stable constant for the SSR server snapshot — must not be recreated on each call.
const EMPTY_TRACKED: TrackedShooter[] = [];

export function useTrackedShooters() {
  const tracked = useSyncExternalStore(
    subscribeTracked,
    getTrackedShootersSnapshot,
    () => EMPTY_TRACKED,
  );
  const trackedIds = useMemo(
    () => new Set(tracked.map((t) => t.shooterId)),
    [tracked],
  );
  return {
    tracked,
    trackedIds,
    add: addTrackedShooter,
    remove: removeTrackedShooter,
  };
}
