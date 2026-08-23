import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LiveGridResponse } from "@/lib/types";

const FIXTURE: LiveGridResponse = {
  match_id: 1,
  stages: [
    { stage_id: 10, stage_num: 1, name: "Cold Start", max_points: 60 },
    { stage_id: 11, stage_num: 2, name: "Doubles", max_points: 40 },
  ],
  shooters: [
    {
      id: 1,
      shooterId: 500,
      name: "Mathias Axell",
      competitor_number: "118",
      division: "Production",
      squad: "4",
    },
    {
      id: 2,
      shooterId: 501,
      name: "Jonas Berg",
      competitor_number: "042",
      division: "Open",
      squad: "4",
    },
  ],
  cells: {
    1: {
      10: {
        hf: 5.42,
        time: 16.42,
        points: 55,
        a: 11,
        c: 0,
        d: 0,
        m: 0,
        ns: 0,
        p: 0,
        status: "scored",
        created: "2026-08-23T09:00:00Z",
      },
    },
    2: {},
  },
  cacheInfo: { cachedAt: null },
};

vi.mock("@/lib/queries", () => ({
  useLiveGridQuery: () => ({
    data: FIXTURE,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

import { LiveGrid } from "@/components/live-grid";

function renderGrid(over: Partial<React.ComponentProps<typeof LiveGrid>> = {}) {
  return render(
    <LiveGrid
      ct="22"
      id="1"
      shooters={[1, 2]}
      matchName="Swedish Handgun Championship"
      source="squad"
      onSourceChange={vi.fn()}
      onExit={vi.fn()}
      {...over}
    />,
  );
}

describe("LiveGrid", () => {
  it("renders one row per shooter", () => {
    renderGrid();
    expect(screen.getByRole("rowheader", { name: /Mathias/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Jonas/ })).toBeInTheDocument();
  });

  it("renders one column header per stage", () => {
    renderGrid();
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "S2" })).toBeInTheDocument();
  });

  it("gives every stage a labelled rail jump button", () => {
    renderGrid();
    expect(
      screen.getByRole("button", { name: "Jump to stage 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Jump to stage 2" }),
    ).toBeInTheDocument();
  });

  it("marks the identity shooter with a You badge", () => {
    renderGrid({ myShooterId: 500 });
    const row = screen.getByRole("rowheader", { name: /Mathias/ });
    expect(within(row).getByText(/you/i)).toBeInTheDocument();
  });

  it("does not mark other shooters with a You badge", () => {
    renderGrid({ myShooterId: 500 });
    const row = screen.getByRole("rowheader", { name: /Jonas/ });
    expect(within(row).queryByText(/you/i)).not.toBeInTheDocument();
  });

  it("shows the match name", () => {
    renderGrid();
    expect(
      screen.getByText("Swedish Handgun Championship"),
    ).toBeInTheDocument();
  });

  it("offers a way back to the full analysis", () => {
    const onExit = vi.fn();
    renderGrid({ onExit });
    screen.getByRole("button", { name: /full analysis/i }).click();
    expect(onExit).toHaveBeenCalled();
  });

  it("renders a cell button for every shooter and stage combination", () => {
    renderGrid();
    // 2 shooters x 2 stages. The comma anchors this to cell buttons
    // ("Mathias Axell, stage 1") and excludes the rail's "Jump to stage N".
    expect(screen.getAllByRole("button", { name: /, stage \d/i })).toHaveLength(4);
  });
});
