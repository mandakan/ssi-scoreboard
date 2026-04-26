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
) {
  return computeMatchTtl(scoringPct, daysSince, dateStr, 0);
}

describe("computeMatchTtl", () => {
  // ── Completed matches ──────────────────────────────────────────────────────

  it("returns null (permanent) when scoring >= 95% AND daysSince >= 1", () => {
    expect(computeMatchTtl(95, 1, isoHoursFromNow(-24))).toBeNull();
    expect(computeMatchTtl(100, 1, isoHoursFromNow(-24))).toBeNull();
  });

  it("returns null (permanent) when daysSince > 3 regardless of scoring", () => {
    expect(computeMatchTtl(0, 3.1, null)).toBeNull();
    expect(computeMatchTtl(50, 10, isoHoursFromNow(-240))).toBeNull();
  });

  // Regression: during an active match day the upstream scoring_completed
  // can climb past 95% before all squads' scorecards are in. If we flipped
  // the cache to permanent at that point, the last scorecards would never
  // be fetched. Require at least 1 day since start before trusting the
  // scoring threshold.
  it("stays in active-scoring tier when scoring >= 95% but match started same day", () => {
    // 95% scored, match started 6 hours ago → NOT complete
    expect(computeMatchTtl(95, 0.25, isoHoursFromNow(-6))).not.toBeNull();
    expect(computeMatchTtl(98, 0.5, isoHoursFromNow(-12))).not.toBeNull();
    expect(rawTtl(99, 0.9, isoHoursFromNow(-21))).toBe(30);
  });

  it("returns null at boundary: scoring exactly 95, daysSince exactly 1", () => {
    expect(computeMatchTtl(95, 1, isoHoursFromNow(-24))).toBeNull();
  });

  // ── Active scoring ─────────────────────────────────────────────────────────

  it("raw tier is 30s when scoring is between 1–94% and recent", () => {
    expect(rawTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(rawTtl(50, 1, isoHoursFromNow(-24))).toBe(30);
    expect(rawTtl(94, 1, isoHoursFromNow(-24))).toBe(30);
  });

  it("active scoring uses the 30s tier under the default 30s floor", () => {
    // raw = 30, minTtl default = 30 → result = 30 (kept near-real-time for live matches)
    expect(computeMatchTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24))).toBe(30);
  });

  it("active scoring respects an explicit minTtl above the raw tier", () => {
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 60)).toBe(60);
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 600)).toBe(600);
  });

  // ── Pre-match: start > 7 days away ────────────────────────────────────────

  it("returns 4h when start is > 7 days away", () => {
    const dateStr = isoHoursFromNow(8 * 24); // 8 days from now
    expect(computeMatchTtl(0, -8, dateStr)).toBe(4 * 60 * 60);
  });

  it("returns 4h at exact 7d+1h boundary", () => {
    const dateStr = isoHoursFromNow(7 * 24 + 1);
    expect(computeMatchTtl(0, -7.1, dateStr)).toBe(4 * 60 * 60);
  });

  // ── Pre-match: start 2–7 days away ────────────────────────────────────────

  it("returns 1h when start is 2–7 days away", () => {
    const dateStr = isoHoursFromNow(3 * 24); // 3 days from now
    expect(computeMatchTtl(0, -3, dateStr)).toBe(60 * 60);
  });

  it("returns 1h at exact 7 day boundary (≤ 7d)", () => {
    const dateStr = isoHoursFromNow(7 * 24);
    expect(computeMatchTtl(0, -7, dateStr)).toBe(60 * 60);
  });

  // ── Pre-match: start 0–2 days away ────────────────────────────────────────

  it("returns 30min when start is 0–2 days away", () => {
    const dateStr = isoHoursFromNow(12); // 12 hours from now
    expect(computeMatchTtl(0, -0.5, dateStr)).toBe(30 * 60);
  });

  it("returns 30min at exact 2-day boundary", () => {
    const dateStr = isoHoursFromNow(2 * 24);
    expect(computeMatchTtl(0, -2, dateStr)).toBe(30 * 60);
  });

  // ── Match just started: no scoring yet, < 12h past ────────────────────────

  it("returns 5min when match started within last 12 hours (no scoring)", () => {
    const dateStr = isoHoursFromNow(-6); // started 6 hours ago
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
    expect(rawTtl(1, 1, isoHoursFromNow(-24))).toBe(30); // active scoring
    expect(rawTtl(0, 0, null)).toBe(30); // fallback
  });

  it("minTtl clamps active scoring to the specified floor", () => {
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24), 120)).toBe(120);
  });

  it("minTtl does not affect tiers already above the floor", () => {
    const soon = isoHoursFromNow(12);
    // 30 min tier (1800s) >> default minTtl (300s) → unchanged
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
  it("returns null for completed matches", () => {
    expect(computeMatchFreshness(95, 1, isoHoursFromNow(-24))).toBeNull();
    expect(computeMatchFreshness(0, 4, null)).toBeNull();
  });

  it("returns 30s for active scoring (raw, unclamped)", () => {
    expect(computeMatchFreshness(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchFreshness(50, 0.5, isoHoursFromNow(-12))).toBe(30);
    expect(computeMatchFreshness(94, 1, isoHoursFromNow(-24))).toBe(30);
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
    // SWR invariant: TTL must be >= freshness so Redis outlives the freshness
    // window, leaving room for a background refresh to land.
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

describe("isMatchComplete", () => {
  it("true when daysSince > 3, regardless of scoring", () => {
    expect(isMatchComplete(0, 3.1)).toBe(true);
    expect(isMatchComplete(50, 10)).toBe(true);
  });

  it("true when scoring >= 95% AND daysSince >= 1", () => {
    expect(isMatchComplete(95, 1)).toBe(true);
    expect(isMatchComplete(100, 2)).toBe(true);
  });

  it("false when scoring >= 95% but match started same day", () => {
    // Primary regression: high scoring % mid-match-day must not mark complete
    expect(isMatchComplete(95, 0)).toBe(false);
    expect(isMatchComplete(98, 0.5)).toBe(false);
    expect(isMatchComplete(100, 0.99)).toBe(false);
  });

  it("false when scoring low and match is recent", () => {
    expect(isMatchComplete(50, 1)).toBe(false);
    expect(isMatchComplete(0, 0)).toBe(false);
  });

  it("false for future matches", () => {
    expect(isMatchComplete(0, -1)).toBe(false);
    expect(isMatchComplete(0, -10)).toBe(false);
  });
});
