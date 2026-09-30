import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MatchResponse } from "@/lib/types";
import { squadRotation } from "@/lib/stage-rotation";

const weatherSpy = vi.fn<(...args: unknown[]) => unknown>(() => ({
  data: {
    available: true,
    weather: { tempRange: [12.2, 18.4], weatherCode: 2, weatherLabel: "partly cloudy" },
  },
  isLoading: false,
}));

vi.mock("@/lib/queries", () => ({
  usePreMatchWeatherQuery: (...args: unknown[]) => weatherSpy(...args),
}));

import { PreMatchStrip } from "@/components/pre-match-strip";

const STAGES = [1, 2, 3].map((n) => ({
  id: n,
  name: `Stage ${n}`,
  stage_number: n,
  max_points: 60,
}));

const MATCH = {
  lat: 59.1,
  lng: 18.2,
  date: "2026-09-30T08:00:00Z",
  venue: "Test Range",
  region: "SWE",
  stages: STAGES,
  competitors: [{ id: 100, shooterId: 500 }, { id: 101, shooterId: 501 }],
  squads: [{ id: 1, number: 4, name: "Squad 4", competitorIds: [100, 101] }],
} as unknown as MatchResponse;

describe("PreMatchStrip", () => {
  it("shows squad, first stage, weather, opt-in button and info link", () => {
    const onShow = vi.fn();
    render(
      <PreMatchStrip ct="22" id="1" match={MATCH} myShooterId={500} onShowLiveScores={onShow} />,
    );
    expect(screen.getByText(/Squad 4/)).toBeInTheDocument();
    const first = squadRotation(4, STAGES)[0].stage.stage_number;
    expect(screen.getByText(new RegExp(`First stage: ${first}\\b`))).toBeInTheDocument();
    expect(screen.getByText(/12.*18/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show live scores" }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Match info" })).toHaveAttribute(
      "href",
      "/match/22/1/info",
    );
    expect(weatherSpy).toHaveBeenLastCalledWith(59.1, 18.2, "2026-09-30", "Test Range", "SWE");
  });

  it("omits the squad line without an identity but keeps weather and button", () => {
    render(
      <PreMatchStrip ct="22" id="1" match={MATCH} myShooterId={null} onShowLiveScores={vi.fn()} />,
    );
    expect(screen.queryByText(/Squad 4/)).not.toBeInTheDocument();
    expect(screen.getByText(/12.*18/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show live scores" })).toBeInTheDocument();
  });
});
