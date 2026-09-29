import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MatchResponse } from "@/lib/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace }),
}));

const FIXTURE = {
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

describe("Analysis selection seeding", () => {
  beforeEach(() => {
    localStorage.clear();
    replace.mockClear();
    useCompareQuery.mockReset();
    useCompareQuery.mockReturnValue({ data: undefined, isLoading: false, isFetching: false });
    localStorage.setItem(
      "ssi-my-shooter",
      JSON.stringify({ shooterId: 900, name: "Alice", license: null }),
    );
  });

  it("seeds from the grid rows without persisting the seed", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MatchGate ct="22" id="1"><AnalysisPageClient /></MatchGate>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(replace.mock.calls[0][0]).toMatch(/\?competitors=100,200$/);
    expect(localStorage.getItem("ssi_competitors_22_1")).toBeNull();
  });
});
