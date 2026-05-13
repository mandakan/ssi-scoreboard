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
    ...overrides,
  };
}

describe("LiveMatches card", () => {
  it("renders a 'live' indicator (the events list does not carry per-match progress)", () => {
    // SSI deprecated `IpscMatchNode.scoring_completed` (always returns 0)
    // and the replacement `scoring_progress` is per-stage, which would
    // multiply the events list query cost by stage count. The card
    // therefore surfaces only a live indicator; the actual percentage is
    // shown on the match page once stages load.
    render(<LiveMatchCard match={event({ id: 1 })} />);
    expect(screen.getByText(/live/i)).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders the match name and venue", () => {
    render(<LiveMatchCard match={event({ id: 2, name: "Hello Cup", venue: "Range B" })} />);
    expect(screen.getByText("Hello Cup")).toBeTruthy();
    expect(screen.getByText(/Range B/)).toBeTruthy();
  });

  it("renders a Private pill for organizer-published matches", () => {
    // SSI's events list surfaces matches with non-public visibility (res/csd/clb)
    // even though their details may not be accessible. The pill warns the user
    // before they tap into a match that might 404.
    render(
      <LiveMatchCard
        match={event({
          id: 3,
          visibility: {
            class: "organizer-published",
            rawCode: "res",
            displayName: "Restricted, searchable but details/names only participants",
          },
        })}
      />,
    );
    expect(screen.getByText("Private")).toBeTruthy();
  });

  it("does not render a Private pill for public matches", () => {
    render(
      <LiveMatchCard
        match={event({
          id: 4,
          visibility: {
            class: "public",
            rawCode: "pub",
            displayName: "Public, searchable and details/names for all",
          },
        })}
      />,
    );
    expect(screen.queryByText("Private")).toBeNull();
  });
});
