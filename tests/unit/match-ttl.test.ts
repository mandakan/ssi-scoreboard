import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeMatchTtl, computeMatchFreshness, isMatchComplete } from "@/lib/match-ttl";

const NOW = new Date("2025-06-15T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function isoHoursFromNow(hours: number): string {
  return new Date(NOW + hours * 3_600_000).toISOString();
}

// Shorthand: test raw tier values without the minimum floor applied
function rawTtl(
  scoringPct: number,
  daysSince: number,
  dateStr: string | null,
  signals?: { status?: string | null; resultsPublished?: boolean },
) {
  return computeMatchTtl(scoringPct, daysSince, dateStr, 0, signals);
}

describe("isMatchComplete", () => {
  // ── Cancellation ──────────────────────────────────────────────────────────
  it("true immediately when status='cs' regardless of timing", () => {
    expect(isMatchComplete(0, 0, { status: "cs" })).toBe(true);
    expect(isMatchComplete(50, 0.5, { status: "cs" })).toBe(true);
    expect(isMatchComplete(99, -1, { status: "cs" })).toBe(true);
  });

  // ── Historical fallback (>7 days) ────────────────────────────────────────
  it("true when daysSince > 7 regardless of other signals", () => {
    expect(isMatchComplete(0, 7.1)).toBe(true);
    expect(isMatchComplete(50, 10)).toBe(true);
    expect(isMatchComplete(98, 365)).toBe(true);
  });

  // ── Hard time gate: nothing pins inside the match window ─────────────────
  // Critical regression guard: this is the Skepplanda Apr 2026 bug. Even
  // if SSI prematurely flips status='cp' or results='all' on day 1 of a
  // multi-day match, we MUST keep refreshing. Late RO scorecards arrive
  // for hours after the last shot.
  it("does NOT pin inside the time gate (daysSince <= MATCH_COMPLETE_DAYS_SINCE) even when SSI flagged complete", () => {
    expect(isMatchComplete(100, 0, { status: "cp" })).toBe(false);
    expect(isMatchComplete(100, 1, { status: "cp" })).toBe(false);
    expect(isMatchComplete(100, 2, { status: "cp" })).toBe(false);
    expect(isMatchComplete(100, 3, { status: "cp" })).toBe(false);

    expect(isMatchComplete(100, 0, { resultsPublished: true })).toBe(false);
    expect(isMatchComplete(100, 1.5, { resultsPublished: true })).toBe(false);
    expect(isMatchComplete(100, 3, { resultsPublished: true })).toBe(false);
  });

  it("does NOT pin inside the time gate via the scoring threshold alone", () => {
    expect(isMatchComplete(98, 0)).toBe(false);
    expect(isMatchComplete(99, 1)).toBe(false);
    expect(isMatchComplete(99.58, 2)).toBe(false); // Skepplanda's final scoring on day 2
    expect(isMatchComplete(100, 3)).toBe(false);
  });

  // ── Past the time gate ───────────────────────────────────────────────────
  it("true when past time gate AND status='cp'", () => {
    expect(isMatchComplete(85.7, 3.1, { status: "cp" })).toBe(true);
    expect(isMatchComplete(0, 4, { status: "cp" })).toBe(true);
  });

  it("true when past time gate AND results published", () => {
    expect(isMatchComplete(87.8, 3.1, { resultsPublished: true })).toBe(true);
    expect(isMatchComplete(0, 5, { resultsPublished: true })).toBe(true);
  });

  it("true when past time gate AND scoring >= MATCH_COMPLETE_SCORING_PCT (default 98)", () => {
    expect(isMatchComplete(98, 3.1)).toBe(true);
    expect(isMatchComplete(99.58, 4)).toBe(true);
    expect(isMatchComplete(100, 3.5)).toBe(true);
  });

  it("false past time gate when scoring < threshold AND no SSI flag", () => {
    expect(isMatchComplete(85, 4)).toBe(false);
    expect(isMatchComplete(50, 6)).toBe(false);
    expect(isMatchComplete(97.9, 5)).toBe(false);
  });

  // ── Future matches ───────────────────────────────────────────────────────
  it("false for future matches", () => {
    expect(isMatchComplete(0, -1)).toBe(false);
    expect(isMatchComplete(0, -10)).toBe(false);
  });
});

describe("computeMatchTtl", () => {
  // ── Permanent (completed) ────────────────────────────────────────────────

  it("returns null (permanent) when historical fallback applies", () => {
    expect(computeMatchTtl(0, 7.1, null)).toBeNull();
    expect(computeMatchTtl(50, 10, isoHoursFromNow(-240))).toBeNull();
    expect(computeMatchTtl(98, 365, null)).toBeNull();
  });

  it("returns null (permanent) when past time gate AND scoring threshold met", () => {
    expect(computeMatchTtl(98, 3.5, isoHoursFromNow(-84))).toBeNull();
    expect(computeMatchTtl(100, 4, isoHoursFromNow(-96))).toBeNull();
  });

  it("returns null (permanent) when past time gate AND SSI flagged", () => {
    expect(
      computeMatchTtl(50, 4, isoHoursFromNow(-96), undefined, { status: "cp" }),
    ).toBeNull();
    expect(
      computeMatchTtl(0, 4, isoHoursFromNow(-96), undefined, { resultsPublished: true }),
    ).toBeNull();
  });

  it("returns null (permanent) immediately for cancelled matches", () => {
    expect(
      computeMatchTtl(0, 0, isoHoursFromNow(-1), undefined, { status: "cs" }),
    ).toBeNull();
  });

  // Critical regression: mid-match SSI flag flip must NOT cause permanent
  // pinning. Skepplanda Apr 2026: organizer flipped results=all on day 2
  // while squads still had unscored stages.
  it("stays in active-scoring tier inside the time gate even when SSI flag fires", () => {
    expect(
      computeMatchTtl(95, 0.25, isoHoursFromNow(-6), undefined, { status: "cp" }),
    ).not.toBeNull();
    expect(
      computeMatchTtl(98, 1, isoHoursFromNow(-24), undefined, { resultsPublished: true }),
    ).not.toBeNull();
    expect(
      computeMatchTtl(99, 2, isoHoursFromNow(-48), undefined, { status: "cp", resultsPublished: true }),
    ).not.toBeNull();
    expect(
      computeMatchTtl(99.58, 2.5, isoHoursFromNow(-60), undefined, { status: "cp" }),
    ).not.toBeNull();
  });

  it("stays in active-scoring tier when scoring >= 95% but inside time gate", () => {
    expect(computeMatchTtl(95, 0.25, isoHoursFromNow(-6))).not.toBeNull();
    expect(computeMatchTtl(98, 0.5, isoHoursFromNow(-12))).not.toBeNull();
    expect(computeMatchTtl(95, 1, isoHoursFromNow(-24))).not.toBeNull();
    expect(computeMatchTtl(98, 3, isoHoursFromNow(-72))).not.toBeNull();
    expect(rawTtl(99, 0.9, isoHoursFromNow(-21))).toBe(30);
  });

  // ── Active scoring ─────────────────────────────────────────────────────────

  it("raw tier is 30s when scoring is between 1–94% and recent", () => {
    expect(rawTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(rawTtl(50, 1, isoHoursFromNow(-24))).toBe(30);
    expect(rawTtl(94, 1, isoHoursFromNow(-24))).toBe(30);
  });

  it("active scoring uses the 30s tier under the default 30s floor", () => {
    expect(computeMatchTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24))).toBe(30);
  });

  it("active scoring respects an explicit minTtl above the raw tier", () => {
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 60)).toBe(60);
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 600)).toBe(600);
  });

  // ── Pre-match: start > 7 days away ────────────────────────────────────────

  it("returns 4h when start is > 7 days away", () => {
    const dateStr = isoHoursFromNow(8 * 24);
    expect(computeMatchTtl(0, -8, dateStr)).toBe(4 * 60 * 60);
  });

  it("returns 4h at exact 7d+1h boundary", () => {
    const dateStr = isoHoursFromNow(7 * 24 + 1);
    expect(computeMatchTtl(0, -7.1, dateStr)).toBe(4 * 60 * 60);
  });

  // ── Pre-match: start 2–7 days away ────────────────────────────────────────

  it("returns 1h when start is 2–7 days away", () => {
    const dateStr = isoHoursFromNow(3 * 24);
    expect(computeMatchTtl(0, -3, dateStr)).toBe(60 * 60);
  });

  it("returns 1h at exact 7 day boundary (≤ 7d)", () => {
    const dateStr = isoHoursFromNow(7 * 24);
    expect(computeMatchTtl(0, -7, dateStr)).toBe(60 * 60);
  });

  // ── Pre-match: start 0–2 days away ────────────────────────────────────────

  it("returns 30min when start is 0–2 days away", () => {
    const dateStr = isoHoursFromNow(12);
    expect(computeMatchTtl(0, -0.5, dateStr)).toBe(30 * 60);
  });

  it("returns 30min at exact 2-day boundary", () => {
    const dateStr = isoHoursFromNow(2 * 24);
    expect(computeMatchTtl(0, -2, dateStr)).toBe(30 * 60);
  });

  // ── Match just started: no scoring yet, < 12h past ────────────────────────

  it("returns 5min when match started within last 12 hours (no scoring)", () => {
    const dateStr = isoHoursFromNow(-6);
    expect(computeMatchTtl(0, 0.25, dateStr)).toBe(5 * 60);
  });

  it("returns 5min at just past start (0h)", () => {
    const dateStr = isoHoursFromNow(-0.1);
    expect(computeMatchTtl(0, 0, dateStr)).toBe(5 * 60);
  });

  // ── Fallback ───────────────────────────────────────────────────────────────

  it("raw fallback is 30s when dateStr is null and scoring is 0", () => {
    expect(rawTtl(0, 0, null)).toBe(30);
  });

  it("fallback uses the 30s tier under the default 30s floor when dateStr is null", () => {
    expect(computeMatchTtl(0, 0, null)).toBe(30);
    expect(computeMatchTtl(0, -1, null)).toBe(30);
    expect(computeMatchTtl(0, 1, null)).toBe(30);
  });

  // ── Minimum TTL floor ──────────────────────────────────────────────────────

  it("minTtl=0 disables the floor and returns raw tier values", () => {
    expect(rawTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(rawTtl(0, 0, null)).toBe(30);
  });

  it("minTtl clamps active scoring to the specified floor", () => {
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 120)).toBe(120);
  });

  it("minTtl does not affect tiers already above the floor", () => {
    const soon = isoHoursFromNow(12);
    expect(computeMatchTtl(0, -0.5, soon, 300)).toBe(30 * 60);
  });

  // ── Negative daysSince (future match) with dateStr ────────────────────────

  it("handles negative daysSince correctly — uses dateStr tiers", () => {
    const far = isoHoursFromNow(10 * 24);
    expect(computeMatchTtl(0, -10, far)).toBe(4 * 60 * 60);

    const medium = isoHoursFromNow(4 * 24);
    expect(computeMatchTtl(0, -4, medium)).toBe(60 * 60);

    const soon = isoHoursFromNow(24);
    expect(computeMatchTtl(0, -1, soon)).toBe(30 * 60);
  });
});

describe("computeMatchFreshness", () => {
  it("returns null for completed matches (historical or signal-driven)", () => {
    expect(computeMatchFreshness(0, 8, null)).toBeNull();
    expect(computeMatchFreshness(98, 4, isoHoursFromNow(-96))).toBeNull();
    expect(
      computeMatchFreshness(0, 4, isoHoursFromNow(-96), { resultsPublished: true }),
    ).toBeNull();
  });

  it("returns 30s for active scoring (raw, unclamped) — including inside time gate with SSI flag", () => {
    expect(computeMatchFreshness(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchFreshness(50, 0.5, isoHoursFromNow(-12))).toBe(30);
    expect(computeMatchFreshness(94, 1, isoHoursFromNow(-24))).toBe(30);
    // Mid-match flag flip must not turn off freshness either.
    expect(
      computeMatchFreshness(98, 1, isoHoursFromNow(-24), { status: "cp" }),
    ).toBe(30);
  });

  it("returns 4h when start is > 7 days away", () => {
    expect(computeMatchFreshness(0, -8, isoHoursFromNow(8 * 24))).toBe(4 * 60 * 60);
  });

  it("returns 1h when start is 2–7 days away", () => {
    expect(computeMatchFreshness(0, -3, isoHoursFromNow(3 * 24))).toBe(60 * 60);
  });

  it("returns 30min when start is 0–2 days away", () => {
    expect(computeMatchFreshness(0, -0.5, isoHoursFromNow(12))).toBe(30 * 60);
  });

  it("returns 5min when match just started (no scoring, < 12h past)", () => {
    expect(computeMatchFreshness(0, 0.25, isoHoursFromNow(-6))).toBe(5 * 60);
  });

  it("returns 30s as the fallback (no date, no scoring)", () => {
    expect(computeMatchFreshness(0, 0, null)).toBe(30);
  });

  it("is always <= computeMatchTtl (the floor never exceeds freshness)", () => {
    const cases: Array<[number, number, string | null]> = [
      [50, 1, isoHoursFromNow(-24)],
      [0, -3, isoHoursFromNow(3 * 24)],
      [0, -0.5, isoHoursFromNow(12)],
      [0, 0.25, isoHoursFromNow(-6)],
      [0, 0, null],
    ];
    for (const [pct, days, date] of cases) {
      const f = computeMatchFreshness(pct, days, date);
      const t = computeMatchTtl(pct, days, date);
      expect(f).not.toBeNull();
      expect(t).not.toBeNull();
      expect(t!).toBeGreaterThanOrEqual(f!);
    }
  });
});
