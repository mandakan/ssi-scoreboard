"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  isPreviewEnabled,
  processPreviewParams,
  type PreviewFeatureId,
} from "@/lib/feature-previews";

const emptySubscribe = () => () => {};

/**
 * SSR-safe hook that returns whether a preview feature is enabled.
 * On mount, processes `?preview=` URL params from the current location.
 */
export function usePreviewFeature(id: PreviewFeatureId): boolean {
  // Process URL params once on mount — may toggle localStorage
  useEffect(() => {
    processPreviewParams(new URLSearchParams(window.location.search));
  }, []);

  // Read from localStorage via useSyncExternalStore (no subscribe needed —
  // the value only changes on mount from URL params, then stays static).
  return useSyncExternalStore(
    emptySubscribe,
    () => isPreviewEnabled(id),
    () => false, // server snapshot
  );
}
