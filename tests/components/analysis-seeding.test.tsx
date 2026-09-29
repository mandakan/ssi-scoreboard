import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MatchResponse } from "@/lib/types";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
}));

let FIXTURE = {
  name: "Test Match",
  date: null,
  ends: null,
  scoring_pct: 40,
  results_status: "org",
  match_status: "on",
  is_live_scores_accessible: true,
  ssi_url: null,
  cacheInfo: { cachedAt: null },
  competitors: [
    { id: 100, shooterId: 900, name: "Alice", competitor_number: "1", club: null, division: null },
    { id: 200, shooterId: 901, name: "Bob", competitor_number: "2", club: null, division: null },
  ],
  squads: [{ id: 1, number: 1, name: "Squad 1", competitorIds: [100, 200] }],
} as unknown as MatchResponse;
const LIVE = FIXTURE;

const useCompareQuery = vi.fn();
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useMatchQuery: () => ({ isLoading: false, isError: false, isFetching: false, data: FIXTURE }),
  useCompareQuery: (...a: unknown[]) => useCompareQuery(...a),
  useCoachingAvailability: () => ({ data: { available: false } }),
  useShooterDashboardQuery: () => ({ data: undefined }),
}));

import { MatchGate } from "@/components/match-gate";
import AnalysisPageClient from "@/app/match/[ct]/[id]/analysis/analysis-page-client";

const lastIds = () => useCompareQuery.mock.calls.at(-1)?.[2];

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchGate ct="22" id="1"><AnalysisPageClient /></MatchGate>
    </QueryClientProvider>,
  );
}

describe("Analysis selection", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    replace.mockClear();
    search = "";
    FIXTURE = LIVE;
    useCompareQuery.mockReset();
    useCompareQuery.mockReturnValue({ data: undefined, isLoading: false, isFetching: false });
    localStorage.setItem(
      "ssi-my-shooter",
      JSON.stringify({ shooterId: 900, name: "Alice", license: null }),
    );
  });

  it("seeds from the grid rows without persisting or writing the URL", () => {
    renderPage();
    expect(lastIds()).toEqual([100, 200]);
    expect(localStorage.getItem("ssi_competitors_22_1")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("persists an explicit URL selection and prefers it", () => {
    search = "competitors=200";
    renderPage();
    expect(lastIds()).toEqual([200]);
    expect(localStorage.getItem("ssi_competitors_22_1")).toBe("[200]");
  });

  it("reflects an already-saved selection into the URL", () => {
    localStorage.setItem("ssi_competitors_22_1", "[100]");
    renderPage();
    expect(lastIds()).toEqual([100]);
    expect(replace).toHaveBeenCalledWith(expect.stringMatching(/\?competitors=100$/), { scroll: false });
  });

  it("Clear does not re-seed; Undo restores the seeded ids and persists them as an edit", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /clear all selected competitors/i }));
    expect(lastIds()).toEqual([]);
    expect(localStorage.getItem("ssi_competitors_22_1")).toBe("[]");
    fireEvent.click(screen.getByRole("button", { name: /undo last selection change/i }));
    expect(lastIds()).toEqual([100, 200]);
    expect(localStorage.getItem("ssi_competitors_22_1")).toBe("[100,200]");
    expect(replace).toHaveBeenLastCalledWith(expect.stringMatching(/\?competitors=100,200$/), { scroll: false });
  });
});

describe("Analysis pre-match compare gating", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    replace.mockClear();
    search = "competitors=100,200";
    FIXTURE = { ...LIVE, scoring_pct: 0 } as MatchResponse;
    useCompareQuery.mockReset();
    useCompareQuery.mockReturnValue({ data: undefined, isLoading: false, isFetching: false });
  });

  it("does not compare until the user opts in", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Scoring has not really started" })).toBeInTheDocument();
    for (const call of useCompareQuery.mock.calls) expect(call[2]).toEqual([]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show live scores" }));
    });
    expect(lastIds()).toEqual([100, 200]);
    expect(useCompareQuery.mock.calls.at(-1)?.[3]).toBe("live");
    expect(screen.queryByRole("heading", { name: "Scoring has not really started" })).toBeNull();
    expect(sessionStorage.getItem("ssi_scores_optin_22_1")).not.toBeNull();
  });
});
