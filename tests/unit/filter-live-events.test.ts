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
    scoring_completed: 0,
    ...overrides,
  };
}

describe("filterLiveEvents", () => {
  // ~40 minutes after the default fixture start — matches the SPSK Open 2026
  // moment when this regression was reported.
  const NOW = new Date("2026-05-02T07:40:00Z").getTime();

  it("includes active matches with scoring_completed > 0", () => {
    const out = filterLiveEvents([event({ scoring_completed: 25 })], NOW);
    expect(out).toHaveLength(1);
  });

  it("excludes matches at 100% scoring (already finished)", () => {
    const out = filterLiveEvents([event({ scoring_completed: 100 })], NOW);
    expect(out).toHaveLength(0);
  });

  it("excludes matches not in 'on' status", () => {
    const out = filterLiveEvents(
      [event({ status: "cp", scoring_completed: 50 })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("includes status='on' matches with scoring_completed=0 if they started within the window (SPSK Open regression)", () => {
    // SSI's match-level scoring_completed aggregate returned "0" for
    // match 22/27190 while every stage independently reported 21-29%.
    // The home page's Live Now section must still surface this match.
    const out = filterLiveEvents(
      [event({ scoring_completed: 0, status: "on" })],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it("excludes status='on' matches that started >6h after their declared end (lingering 'on')", () => {
    // Some organizers are slow to flip status to 'cp'. Without an upper
    // time bound the home page would accumulate stale "live" matches.
    const startedSevenDaysAgo = new Date(NOW - 7 * 24 * HOUR_MS).toISOString();
    const endedSixDaysAgo = new Date(NOW - 6 * 24 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ scoring_completed: 0, date: startedSevenDaysAgo, ends: endedSixDaysAgo })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("excludes future matches that haven't started yet", () => {
    const startsTomorrow = new Date(NOW + 24 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ scoring_completed: 0, date: startsTomorrow, ends: null })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it("includes single-day matches with no `ends` if started in the last 24h", () => {
    const startedTwoHoursAgo = new Date(NOW - 2 * HOUR_MS).toISOString();
    const out = filterLiveEvents(
      [event({ scoring_completed: 0, date: startedTwoHoursAgo, ends: null })],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it("preserves order across the input list", () => {
    const a = event({ id: 1, scoring_completed: 30 });
    const b = event({ id: 2, scoring_completed: 0 });
    const c = event({ id: 3, scoring_completed: 80 });
    const out = filterLiveEvents([a, b, c], NOW);
    expect(out.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("excludes events with unparseable date when scoring_completed is 0", () => {
    const out = filterLiveEvents(
      [event({ scoring_completed: 0, date: "not-a-date" })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });
});
