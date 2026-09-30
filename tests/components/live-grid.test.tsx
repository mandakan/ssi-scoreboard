import { fireEvent, render, screen, within } from "@testing-library/react";
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

const useLiveGridQuerySpy = vi.fn<(...args: unknown[]) => unknown>(() => ({
  data: FIXTURE,
  isLoading: false,
  isFetching: false,
  error: null,
}));

vi.mock("@/lib/queries", () => ({
  useLiveGridQuery: (...args: unknown[]) => useLiveGridQuerySpy(...args),
}));

import { LiveGrid } from "@/components/live-grid";

function renderGrid(over: Partial<React.ComponentProps<typeof LiveGrid>> = {}) {
  return render(
    <LiveGrid
      ct="22"
      id="1"
      shooters={[1, 2]}
      source="squad"
      onSourceChange={vi.fn()}
      {...over}
    />,
  );
}

describe("LiveGrid", () => {
  it("polls by default (live)", () => {
    useLiveGridQuerySpy.mockClear();
    renderGrid();
    expect(useLiveGridQuerySpy).toHaveBeenLastCalledWith("22", "1", [1, 2], { live: true });
  });

  it("passes live=false to the query so a completed match does not poll", () => {
    useLiveGridQuerySpy.mockClear();
    renderGrid({ live: false });
    expect(useLiveGridQuerySpy).toHaveBeenLastCalledWith("22", "1", [1, 2], { live: false });
  });

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

  it("has no per-stage rail buttons (indicator only)", () => {
    renderGrid();
    expect(
      screen.queryAllByRole("button", { name: /jump to stage \d+$/i }),
    ).toHaveLength(0);
    expect(screen.getByText("Stages done:")).toBeInTheDocument();
  });

  it("offers one Live jump button that scrolls to the live stage", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    try {
      renderGrid();
      scrollTo.mockClear();
      const btn = screen.getByRole("button", { name: "Jump to live stage 1" });
      expect(btn).toHaveTextContent("Live: S1");
      fireEvent.click(btn);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it("shows Manage only for the tracked source and calls onManage", () => {
    const onManage = vi.fn();
    const { unmount } = renderGrid({ source: "squad", onManage });
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
    unmount();
    renderGrid({ source: "tracked", onManage });
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(onManage).toHaveBeenCalledTimes(1);
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

  it("keeps the surname when the first name is already an initial", () => {
    // Some competitors register as "A. Lindstrom". Treating the first token
    // as a full first name collapses that to "A. L." and loses the surname
    // entirely -- the one part that identifies them.
    renderGrid();
    expect(
      screen.queryByRole("rowheader", { name: /^M\. A\./ }),
    ).not.toBeInTheDocument();
  });

  it("renders a cell button for every shooter and stage combination", () => {
    renderGrid();
    // 2 shooters x 2 stages. The comma anchors this to cell buttons
    // ("Mathias Axell, stage 1") and excludes the header buttons.
    expect(screen.getAllByRole("button", { name: /, stage \d/i })).toHaveLength(4);
  });
});
