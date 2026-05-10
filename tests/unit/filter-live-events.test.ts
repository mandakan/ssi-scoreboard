import { describe, expect, it } from "vitest";
import { filterLiveEvents } from "@/app/api/events/route";
import type { EventSummary } from "@/lib/types";

const HOUR_MS = 3_600_000;

function event(overrides: Partial<EventSummary>): EventSummary {
  return {
    id: 27190,
    content_type: 22,
    name: "Test Match",
    venue: null,
    date: "2026-05-02T07:00:00Z",
    ends: "2026-05-03T16:00:00Z",
    status: "on",
    region: "SWE",
    discipline: "IPSC Handgun",
    level: "Level II",
    registration_status: "cl",
    registration_starts: null,
    registration_closes: null,
    is_registration_possible: false,
    squadding_starts: null,
    squadding_closes: null,
    is_squadding_possible: false,
    max_competitors: null,
    ...overrides,
  };
}

describe("filterLiveEvents", () => {
  // ~40 minutes after the default fixture start — matches the SPSK Open 2026
  // moment when this regression was reported.
  const NOW = new Date("2026-05-02T07:40:00Z").getTime();

  it("includes active matches that started within the window", () => {
    const out = filterLiveEvents([event({})], NOW);
    expect(out).toHaveLength(1);
  });

  it("excludes matches not in 'on' status", () => {
    const out = filterLiveEvents([event({ status: "cp" })], NOW);
    expect(out).toHaveLength(0);
  });

  it("excludes status='on' matches that started >6h after their declared end (lingering 'on')", () => {
    // Some organizers are slow to flip status to 'cp'. Without an upper
    // time bound the home page would accumulate stale "live" matches.
    const startedSevenDaysAgo = new Date(NOW - 7 * 24 * HOUR_MS).toISOString();
    const endedSixDaysAgo = new Date(NOW - 6 * 24 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ date: startedSevenDaysAgo, ends: endedSixDaysAgo })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("excludes future matches that haven't started yet", () => {
    const startsTomorrow = new Date(NOW + 24 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ date: startsTomorrow, ends: null })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("includes single-day matches with no `ends` if started in the last 24h", () => {
    const startedTwoHoursAgo = new Date(NOW - 2 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ date: startedTwoHoursAgo, ends: null })],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it("preserves order across the input list", () => {
    const a = event({ id: 1 });
    const b = event({ id: 2 });
    const c = event({ id: 3 });
    const out = filterLiveEvents([a, b, c], NOW);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("excludes events with unparseable date", () => {
    const out = filterLiveEvents([event({ date: "not-a-date" })], NOW);
    expect(out).toHaveLength(0);
  });
});
