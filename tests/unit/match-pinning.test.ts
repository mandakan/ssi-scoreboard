/**
 * Rigid regression tests for the cache-pinning decision (TTL=null → permanent
 * durable storage). The Skepplanda Apr 2026 incident was caused by exactly
 * this bit of logic flipping early; if it ever regresses again the symptom
 * is "stale match data stuck for an entire match day with no way to
 * refresh." So this file is intentionally over-specified: it locks in the
 * exact (scoringPct x daysSince x SSI signals) matrix where pinning is
 * allowed vs. forbidden.
 *
 * If a future refactor makes one of these tests fail, **stop and audit**.
 * Do NOT relax the assertions just to make the suite green — every "MUST
 * NOT pin" case is here because allowing pinning in that state would
 * reproduce a real-world data-staleness bug.
 *
 * The function under test is `computeMatchTtl()` returning `null` (which is
 * the literal Boolean for "pin permanently to D1, drop Redis to drain TTL").
 * `isMatchComplete()` is the underlying predicate; both are exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeMatchTtl,
  computeMatchSwrTtl,
  isMatchComplete,
  type MatchSsiSignals,
} from "@/lib/match-ttl";

const NOW = new Date("2026-05-01T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function dateForDaysSince(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

/** True iff `computeMatchTtl()` returns null — i.e. the cache will be pinned. */
function pins(scoringPct: number, daysSince: number, signals: MatchSsiSignals = {}): boolean {
  const t = computeMatchTtl(
    scoringPct,
    daysSince,
    daysSince >= 0 ? dateForDaysSince(daysSince) : new Date(NOW + Math.abs(daysSince) * 86_400_000).toISOString(),
    undefined,
    signals,
  );
  return t === null;
}

/** Sanity: SWR variant must agree with the regular variant on pinning decisions. */
function pinsSwr(scoringPct: number, daysSince: number, signals: MatchSsiSignals = {}): boolean {
  const t = computeMatchSwrTtl(
    scoringPct,
    daysSince,
    daysSince >= 0 ? dateForDaysSince(daysSince) : new Date(NOW + Math.abs(daysSince) * 86_400_000).toISOString(),
    signals,
  );
  return t === null;
}

describe("pinning: MUST NOT pin during the active match window", () => {
  // The hard time gate is the single most important guarantee in this file.
  // Inside the time gate, NO combination of signals may pin permanently.
  // (Cancellation is the lone exception — handled in its own block below.)

  const signalCombos: Array<[string, MatchSsiSignals]> = [
    ["no signals", {}],
    ["status=on", { status: "on" }],
    ["status=cp (premature flip)", { status: "cp" }],
    ["status=dr (draft)", { status: "dr" }],
    ["resultsPublished=true", { resultsPublished: true }],
    ["status=cp + resultsPublished", { status: "cp", resultsPublished: true }],
  ];
  const scoringValues = [0, 25, 50, 75, 90, 95, 98, 99, 99.58, 99.9, 100];
  const daysSinceValues = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3];

  for (const [comboName, signals] of signalCombos) {
    for (const scoring of scoringValues) {
      for (const days of daysSinceValues) {
        it(`MUST NOT pin (scoring=${scoring}%, daysSince=${days}d, ${comboName})`, () => {
          expect(pins(scoring, days, signals)).toBe(false);
          expect(pinsSwr(scoring, days, signals)).toBe(false);
          expect(isMatchComplete(scoring, days, signals)).toBe(false);
        });
      }
    }
  }
});

describe("pinning: cancelled matches are immediately terminal", () => {
  // status="cs" is the one signal that bypasses the time gate. A cancelled
  // match cannot resume — no scoring will ever be added — so pinning
  // immediately is safe and saves upstream calls.

  const cancellationCases: Array<[number, number]> = [
    [0, 0],
    [0, 0.5],
    [50, 1],
    [100, 0],
    [99, 5],
    [0, -1], // cancelled before it started (e.g. weather)
  ];
  for (const [scoring, days] of cancellationCases) {
    it(`pins when status="cs" (scoring=${scoring}%, daysSince=${days}d)`, () => {
      expect(pins(scoring, days, { status: "cs" })).toBe(true);
      expect(isMatchComplete(scoring, days, { status: "cs" })).toBe(true);
    });
  }
});

describe("pinning: historical fallback at >7 days", () => {
  // Even an SSI-abandoned match with 0% scoring will pin once it crosses
  // the 7-day floor. This is the safety hatch — any match this old is
  // clearly not going to update.

  const historicalCases: Array<[number, number]> = [
    [0, 7.1],
    [10, 7.5],
    [50, 10],
    [98, 30],
    [0, 365],
  ];
  for (const [scoring, days] of historicalCases) {
    it(`pins beyond 7-day floor (scoring=${scoring}%, daysSince=${days}d, no signals)`, () => {
      expect(pins(scoring, days)).toBe(true);
    });
  }

  it("does NOT pin at exactly 7 days with low scoring (boundary)", () => {
    // 7 days is the ceiling of the heuristic window — past it, pinning kicks
    // in. At exactly 7d we're still in heuristic land.
    expect(pins(50, 7)).toBe(false);
    expect(isMatchComplete(50, 7)).toBe(false);
  });

  it("pins at 7.001 days (just past the floor)", () => {
    expect(pins(50, 7.001)).toBe(true);
  });
});

describe("pinning: past time gate, signal-driven", () => {
  // Once daysSince > MATCH_COMPLETE_DAYS_SINCE (default 3), any one of the
  // completion signals qualifies. These tests use 3.1 days to be just past
  // the gate and inside the historical floor.

  it("pins past gate when scoring >= MATCH_COMPLETE_SCORING_PCT (default 98)", () => {
    expect(pins(98, 3.1)).toBe(true);
    expect(pins(99.58, 4)).toBe(true); // Skepplanda's final scoring
    expect(pins(100, 3.5)).toBe(true);
  });

  it("does NOT pin past gate if scoring is below threshold and no SSI flag", () => {
    expect(pins(85, 4)).toBe(false);
    expect(pins(50, 6)).toBe(false);
    expect(pins(97.99, 5)).toBe(false);
  });

  it("pins past gate when status='cp' (organizer marked complete)", () => {
    expect(pins(0, 3.1, { status: "cp" })).toBe(true);
    expect(pins(50, 5, { status: "cp" })).toBe(true);
    expect(pins(85.7, 4, { status: "cp" })).toBe(true);
  });

  it("pins past gate when results published", () => {
    expect(pins(0, 3.1, { resultsPublished: true })).toBe(true);
    expect(pins(50, 5, { resultsPublished: true })).toBe(true);
  });
});

describe("pinning: future matches never pin", () => {
  // Pre-match scoreboard view — no scoring possible yet.
  it("does NOT pin matches with negative daysSince", () => {
    expect(pins(0, -1)).toBe(false);
    expect(pins(0, -7)).toBe(false);
    expect(pins(0, -30)).toBe(false);
    // Even with a (nonsensical) cp flag on a future match, don't pin.
    expect(pins(0, -1, { status: "cp" })).toBe(false);
    expect(pins(0, -1, { resultsPublished: true })).toBe(false);
  });
});

describe("regression replay: Skepplanda Challenge 2026 (Apr 24-26)", () => {
  // Exact reproduction of the bug Jimmy With reported. A 3-day Level 3
  // match where stragglers' scorecards landed during day 2 but the cache
  // pinned a stale snapshot. Final scoring was 99.58% — close enough to
  // 100 that a "scoring >= 98 mid-match" rule would catch it. Hence the
  // hard time gate.

  // A match that started 1.5 days ago — i.e. Apr 25 noon during a match
  // that started Apr 24 noon. Day 2 of a 3-day event.
  const day2 = 1.5;

  it("does NOT pin on day 2 even if scoring crosses 95% (the actual bug trigger)", () => {
    expect(pins(95, day2)).toBe(false);
    expect(pins(98, day2)).toBe(false);
    expect(pins(99.58, day2)).toBe(false);
  });

  it("does NOT pin on day 2 even if SSI organizer prematurely flips status=cp", () => {
    expect(pins(95, day2, { status: "cp" })).toBe(false);
    expect(pins(99, day2, { status: "cp" })).toBe(false);
    expect(pins(99.58, day2, { status: "cp", resultsPublished: true })).toBe(false);
  });

  it("does NOT pin on day 2 even if SSI organizer prematurely publishes results", () => {
    expect(pins(95, day2, { resultsPublished: true })).toBe(false);
    expect(pins(99.58, day2, { resultsPublished: true })).toBe(false);
  });

  // Day 3 of a 3-day match (daysSince ~2.5). Still inside the time gate;
  // late stragglers might still arrive that evening.
  it("does NOT pin on day 3 (still inside time gate)", () => {
    expect(pins(99.58, 2.5, { status: "cp", resultsPublished: true })).toBe(false);
  });

  // Day 4 (Apr 28 — match has been over for ~1.5 days). Time gate just
  // passed; SSI flag and high scoring both qualify.
  it("pins on day 4 once time gate clears AND signals agree", () => {
    expect(pins(99.58, 3.1, { status: "cp", resultsPublished: true })).toBe(true);
    expect(pins(99.58, 4)).toBe(true);
  });
});

describe("regression: BEP Pistol-PCC L2 (legitimately completed at 85.7%)", () => {
  // From the Apr 2026 SSI API survey: a 1-day Level II match flagged
  // status=cp with scoring at 85.7%. Some squads simply didn't submit.
  // We must pin this *eventually* so we stop hammering upstream — but
  // not before the time gate.

  it("does NOT pin during the match day even though SSI says complete", () => {
    expect(pins(85.7, 0.5, { status: "cp", resultsPublished: true })).toBe(false);
  });

  it("pins after day 4 with the SSI flag (organizer is the source of truth)", () => {
    expect(pins(85.7, 4, { status: "cp", resultsPublished: true })).toBe(true);
  });

  it("does NOT pin after day 4 with NO SSI flag and scoring <98 (still uncertain)", () => {
    // Without an SSI signal we wait the full 7 days for the historical floor.
    expect(pins(85.7, 4)).toBe(false);
    expect(pins(85.7, 6.9)).toBe(false);
  });
});

describe("env-configurability: thresholds respond to env vars", () => {
  // The thresholds are read at module load time via process.env. We can't
  // easily test alternate values without re-importing the module under
  // different env state, but we can lock in the *defaults* explicitly so
  // an accidental change is caught.

  it("default MATCH_COMPLETE_DAYS_SINCE is exactly 3 (gate at >3, fail at <=3)", () => {
    expect(pins(100, 3)).toBe(false);
    expect(pins(100, 3.001)).toBe(true);
  });

  it("default MATCH_COMPLETE_SCORING_PCT is exactly 98 (qualify at >=98, fail at <98)", () => {
    expect(pins(98, 3.1)).toBe(true);
    expect(pins(97.99, 3.1)).toBe(false);
  });
});

describe("safety: SWR and regular TTL pinning decisions agree", () => {
  // computeMatchSwrTtl differs from computeMatchTtl only in its minimum
  // floor for non-permanent entries. The pinning decision (null vs.
  // non-null) MUST match for both — otherwise the durable-cache write
  // path could disagree with the freshness-window calculation.

  const cases: Array<[number, number, MatchSsiSignals, string]> = [
    [0, 0, {}, "fresh active match"],
    [99, 1, { status: "cp" }, "premature flag flip"],
    [99.58, 2.5, { resultsPublished: true }, "Skepplanda day 3"],
    [50, 4, { status: "cp" }, "past gate with flag"],
    [98, 4, {}, "past gate with scoring"],
    [0, 0, { status: "cs" }, "cancelled"],
    [0, 8, {}, "historical"],
  ];
  for (const [scoring, days, signals, label] of cases) {
    it(`SWR and regular agree on pinning: ${label}`, () => {
      expect(pins(scoring, days, signals)).toBe(pinsSwr(scoring, days, signals));
    });
  }
});

describe("safety: re-pinning is idempotent", () => {
  // If the same (scoring, daysSince, signals) input appears twice, the
  // pinning decision must not flip. This guards against any future
  // memoization/state bug.
  it("same input yields same output across repeated calls", () => {
    for (let i = 0; i < 10; i++) {
      expect(pins(99, 1.5, { status: "cp" })).toBe(false);
      expect(pins(98, 4)).toBe(true);
      expect(pins(0, 0, { status: "cs" })).toBe(true);
    }
  });
});
