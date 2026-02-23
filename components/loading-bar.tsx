"use client";

// A thin top-of-page progress bar with two-phase loading awareness.
//
// Phase 1 (match loading):  bar crawls 0 → ~40% over 12 s
// Phase 2 (compare loading): bar snaps to 55 %, crawls to ~80% over 12 s
// Done:                       bar completes to 100 %, fades out
//
// The component may mount already in phase 2 (skeleton → content transition),
// in which case the phase-2 animation starts immediately.
//
// WCAG SC 4.1.3 (Status Messages): the aria-live region announces phase
// changes to screen readers without requiring focus on the bar.
// The visual bar itself is aria-hidden (decorative only).

import { useEffect, useRef, useState } from "react";

interface LoadingBarProps {
  matchLoaded: boolean;
  compareLoaded: boolean;
  hasCompetitors: boolean;
}

export function LoadingBar({ matchLoaded, compareLoaded, hasCompetitors }: LoadingBarProps) {
  const isDone = matchLoaded && (!hasCompetitors || compareLoaded);

  // Capture values at mount time via refs so the mount-only effect can
  // read them without listing them as dependencies.
  const mountedAsMatchLoaded = useRef(matchLoaded);
  const doneRef = useRef(isDone);

  const [pct, setPct] = useState(() => (matchLoaded ? 55 : 0));
  const [transitionMs, setTransitionMs] = useState(0);
  const [opacity, setOpacity] = useState(1);
  // Initialize as hidden if already done (e.g. instant cache-hit render).
  const [hidden, setHidden] = useState(isDone);

  // ── Mount-time animation ────────────────────────────────────────────────
  // Runs once. All state updates are inside async callbacks to satisfy the
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (doneRef.current) return;

    if (mountedAsMatchLoaded.current) {
      // Mounted already in phase 2 — crawl from 55 → 80%.
      const t = setTimeout(() => {
        setTransitionMs(12_000);
        setPct(80);
      }, 80);
      return () => clearTimeout(t);
    }

    // Phase 1 — crawl from 0 → 40%.
    // Two nested rAFs ensure width=0 has painted before the transition
    // starts so the browser actually animates the width change.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setTransitionMs(12_000);
        setPct(40);
      })
    );
    return () => cancelAnimationFrame(raf);
  }, []); // intentionally empty — mount-only, reads only stable refs

  // ── Phase 1 → 2 transition (within the same component instance) ────────
  useEffect(() => {
    if (!matchLoaded || !hasCompetitors || compareLoaded) return;
    if (doneRef.current || mountedAsMatchLoaded.current) return;

    // Snap to 55 % (setState inside setTimeout — not synchronous in effect body).
    const t0 = setTimeout(() => {
      setTransitionMs(300);
      setPct(55);
    }, 0);
    // Then crawl toward 80 %.
    const t1 = setTimeout(() => {
      setTransitionMs(12_000);
      setPct(80);
    }, 320);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
    };
  }, [matchLoaded, hasCompetitors, compareLoaded]);

  // ── Completion ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDone || doneRef.current) return;
    doneRef.current = true;

    const t0 = setTimeout(() => {
      setTransitionMs(350);
      setPct(100);
    }, 0);
    const t1 = setTimeout(() => setOpacity(0), 450);
    const t2 = setTimeout(() => setHidden(true), 800);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isDone]);

  if (hidden) return null;

  const srText = !matchLoaded
    ? "Loading match…"
    : hasCompetitors && !compareLoaded
      ? "Loading scores…"
      : "";

  return (
    <>
      {/* Screen-reader status announcement (WCAG SC 4.1.3) */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {srText}
      </p>

      {/* Visual bar — decorative, hidden from assistive technology */}
      <div
        aria-hidden="true"
        className="fixed top-0 inset-x-0 z-50 h-[3px] pointer-events-none"
        style={{
          opacity,
          transition: opacity < 1 ? "opacity 350ms ease-out" : undefined,
        }}
      >
        <div
          className="h-full bg-primary"
          style={{
            width: `${pct}%`,
            transition: transitionMs > 0 ? `width ${transitionMs}ms ease-out` : "none",
          }}
        />
      </div>
    </>
  );
}
