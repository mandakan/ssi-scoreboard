"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getAIConsent,
  setAIConsent,
  type AIConsentState,
} from "@/lib/ai-consent";

// Notify all hook instances when consent changes within the same tab.
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emitChange() {
  for (const cb of listeners) cb();
}

/**
 * SSR-safe hook that returns current AI consent state and a setter.
 * All mounted components using this hook update synchronously when consent changes.
 */
export function useAIConsent(): {
  consent: AIConsentState;
  grant: () => void;
  deny: () => void;
} {
  const consent = useSyncExternalStore(
    subscribe,
    getAIConsent,
    () => "unknown" as const,
  );

  const grant = useCallback(() => {
    setAIConsent("granted");
    emitChange();
  }, []);

  const deny = useCallback(() => {
    setAIConsent("denied");
    emitChange();
  }, []);

  return { consent, grant, deny };
}
