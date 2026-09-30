"use client";

import { useEffect, useRef } from "react";

/**
 * Reacts to in-page links like `#chart-speed-accuracy`. Checks
 * `window.location.hash` on mount and on every `hashchange`; when it matches
 * one of `anchors` it calls `onAnchor(anchor)` and then clears the hash
 * (keeping path and query).
 *
 * Clearing means a second click on the same link changes the hash again and
 * fires again, and a stale hash is never re-applied on remount or when the
 * caller's anchor list changes. A hash that matches nothing is left alone so
 * other consumers (or the browser) can still use it.
 *
 * Scrolling is the caller's job: `onAnchor` runs synchronously, before the
 * state it sets has rendered, so callers scroll from a requestAnimationFrame
 * or an effect that runs after the target exists.
 */
export function useHashAnchor(anchors: string[], onAnchor: (anchor: string) => void): void {
  const onAnchorRef = useRef(onAnchor);
  useEffect(() => {
    onAnchorRef.current = onAnchor;
  });

  const key = anchors.join("\n");
  useEffect(() => {
    const list = key === "" ? [] : key.split("\n");
    function check() {
      const raw = window.location.hash;
      const name = raw.startsWith("#") ? raw.slice(1) : raw;
      if (!name || !list.includes(name)) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      onAnchorRef.current(name);
    }
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [key]);
}
