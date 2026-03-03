"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  subscribeTracked,
  getTrackedShootersSnapshot,
  addTrackedShooter,
  removeTrackedShooter,
} from "@/lib/shooter-identity";

export function useTrackedShooters() {
  const tracked = useSyncExternalStore(
    subscribeTracked,
    getTrackedShootersSnapshot,
    () => [],
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
