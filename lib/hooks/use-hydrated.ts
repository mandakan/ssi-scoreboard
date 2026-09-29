"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during the server render and the hydration pass, true afterwards
 * (and immediately on client-only mounts such as soft navigation).
 *
 * Use it to hold back UI that depends on browser-only state (localStorage
 * identity, tracked shooters, saved selections, Date.now()) so the server
 * HTML and the first client render agree and nothing flips visibly.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
