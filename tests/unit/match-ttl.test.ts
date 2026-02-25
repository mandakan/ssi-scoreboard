import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeMatchTtl } from "@/lib/match-ttl";

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

describe("computeMatchTtl", () => {
  // ── Completed matches ──────────────────────────────────────────────────────

  it("returns null (permanent) when scoring >= 95%", () => {
    expect(computeMatchTtl(95, 1, isoHoursFromNow(-24))).toBeNull();
    expect(computeMatchTtl(100, 1, isoHoursFromNow(-24))).toBeNull();
  });

  it("returns null (permanent) when daysSince > 3", () => {
    expect(computeMatchTtl(0, 3.1, null)).toBeNull();
    expect(computeMatchTtl(50, 10, isoHoursFromNow(-240))).toBeNull();
  });

  it("returns null at boundary: scoring exactly 95, daysSince 0", () => {
    expect(computeMatchTtl(95, 0, isoHoursFromNow(0))).toBeNull();
  });

  // ── Active scoring ─────────────────────────────────────────────────────────

  it("returns 30s when scoring is between 1–94% and recent", () => {
    expect(computeMatchTtl(1, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchTtl(50, 1, isoHoursFromNow(-24))).toBe(30);
    expect(computeMatchTtl(94, 1, isoHoursFromNow(-24))).toBe(30);
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

  it("returns 30s fallback when dateStr is null and scoring is 0", () => {
    expect(computeMatchTtl(0, 0, null)).toBe(30);
  });

  it("returns 30s fallback when dateStr is null and daysSince <= 0", () => {
    expect(computeMatchTtl(0, -1, null)).toBe(30);
  });

  it("returns 30s fallback when match started >12h ago but no scoring and no dateStr", () => {
    expect(computeMatchTtl(0, 1, null)).toBe(30);
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
