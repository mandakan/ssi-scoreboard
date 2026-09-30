import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MatchResponse } from "@/lib/types";

vi.mock("@/lib/queries", () => ({
  usePreMatchWeatherQuery: () => ({ data: undefined, isLoading: false }),
  usePreMatchBriefQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useShooterDashboardQuery: () => ({ data: undefined, isLoading: false }),
}));

import { PreMatchView } from "@/components/pre-match-view";

const STAGES = [1, 2, 3].map((n) => ({
  id: n,
  name: `Stage ${n}`,
  stage_number: n,
  max_points: 60,
  min_rounds: 12,
  paper_targets: 6,
  steel_targets: 0,
  ssi_url: null,
  course_display: "Medium",
  procedure: null,
  firearm_condition: null,
}));

const COMPETITORS = [100, 101].map((n, i) => ({
  id: n,
  shooterId: 500 + i,
  name: `Shooter ${i + 1}`,
  competitor_number: String(10 + i),
  club: "Club",
  division: "Production",
  region: null,
  region_display: null,
  category: null,
  ics_alias: null,
  license: null,
}));

const MATCH = {
  name: "Order Test",
  lat: 59.1,
  lng: 18.2,
  date: "2026-09-30T08:00:00Z",
  venue: "Test Range",
  region: "SWE",
  stages: STAGES,
  competitors: COMPETITORS,
  squads: [{ id: 1, number: 4, name: "Squad 4", competitorIds: [100, 101] }],
} as unknown as MatchResponse;

function renderView() {
  return render(
    <PreMatchView
      match={MATCH}
      selectedIds={[]}
      trackedShooterIds={new Set()}
      myShooterId={500}
      ct="22"
      id="1"
      aiAvailable={false}
    />,
  );
}

describe("PreMatchView section order", () => {
  it("orders squad, rotation, weather, AI brief, registered field", () => {
    renderView();
    const texts = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    const idx = (re: RegExp) => texts.findIndex((t) => re.test(t));
    const order = [/Your squad/, /Stage rotation/, /weather/i, /Pre-match brief/, /Registered field/].map(idx);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("collapses the registered field behind an accessible disclosure", () => {
    renderView();
    const button = screen.getByRole("button", { name: /^Registered field/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("id", "registered-field-heading");
    expect(screen.queryByRole("region", { name: /^Registered field/ })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: /^Registered field/ })).toBeInTheDocument();
  });
});
