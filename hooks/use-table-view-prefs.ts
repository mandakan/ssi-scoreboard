"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  applyPreset,
  DEFAULT_PREFS,
  readPrefs,
  toggleGroup as toggleGroupPure,
  writePrefs,
  type TableViewGroup,
  type TableViewPreset,
  type TableViewPrefs,
} from "@/lib/table-view-prefs";

const EVENT_NAME = "ssi-table-view-change";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}

export interface UseTableViewPrefsResult {
  prefs: TableViewPrefs;
  setPreset: (preset: Exclude<TableViewPreset, "custom">) => void;
  toggleGroup: (group: TableViewGroup) => void;
}

export function useTableViewPrefs(): UseTableViewPrefsResult {
  const prefs = useSyncExternalStore(
    subscribe,
    readPrefs,
    () => DEFAULT_PREFS,
  );

  const setPreset = useCallback(
    (preset: Exclude<TableViewPreset, "custom">) => {
      writePrefs(applyPreset(preset));
    },
    [],
  );

  const toggleGroup = useCallback((group: TableViewGroup) => {
    writePrefs(toggleGroupPure(readPrefs(), group));
  }, []);

  return { prefs, setPreset, toggleGroup };
}
