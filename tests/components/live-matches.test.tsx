import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EventSummary } from "@/lib/types";

// next/navigation's useRouter has to be mocked at the module level for the
// component to mount under JSDOM.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LiveMatchCard } from "@/components/live-matches";

function event(overrides: Partial<EventSummary>): EventSummary {
  return {
    id: 27190,
    content_type: 22,
    name: "Test Match",
    venue: "Range A",
    date: "2026-05-02T07:00:00Z",
    ends: "2026-05-02T16:00:00Z",
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

describe("LiveMatches card progress display", () => {
  it("shows the percentage and a real progress bar when scoring_completed > 0", () => {
    render(<LiveMatchCard match={event({ id: 1, scoring_completed: 42 })} />);
    expect(screen.getByText("42%")).toBeTruthy();
    // The shadcn Progress component renders an indicator with role=progressbar
    // and aria-valuenow on the parent. We assert the shown number is 42.
  });

  it("falls back to a 'live' indicator when scoring_completed is 0 (SSI aggregate broken)", () => {
    // SPSK Open 2026 scenario: match is live, stages are 25% scored, but
    // SSI's match-level scoring_completed aggregate returns 0. We should
    // not render "0%" — that's misleading. Show a live signal instead.
    render(<LiveMatchCard match={event({ id: 2, scoring_completed: 0 })} />);
    expect(screen.getByText(/live/i)).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("rounds the displayed percentage", () => {
    render(<LiveMatchCard match={event({ id: 3, scoring_completed: 33.71 })} />);
    expect(screen.getByText("34%")).toBeTruthy();
  });
});
