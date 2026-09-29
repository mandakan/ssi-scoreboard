import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MatchResponse } from "@/lib/types";

// The match layout server-renders the tab children. On the server, identity,
// tracked shooters and the saved selection are all empty, so without a
// hydration gate the grid would render "Pick your squad" (and Analysis its
// empty picker state) and then flip on the client. These tests pin that the
// server HTML is a neutral loading placeholder instead.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  useMatchQuery: () => ({ isLoading: false, isError: false, isFetching: false, data: FIXTURE }),
  useCompareQuery: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
  useCoachingAvailability: () => ({ data: { available: false } }),
  useShooterDashboardQuery: () => ({ data: undefined }),
  useLiveGridQuery: () => ({ data: undefined, isLoading: true, isFetching: false, error: null }),
}));

import { MatchGate } from "@/components/match-gate";
import GridPageClient from "@/app/match/[ct]/[id]/grid-page-client";
import AnalysisPageClient from "@/app/match/[ct]/[id]/analysis/analysis-page-client";

function ssr(children: React.ReactNode): string {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MatchGate ct="22" id="1">{children}</MatchGate>
    </QueryClientProvider>,
  );
}

describe("match tab server render", () => {
  it("grid renders the loading placeholder, not the empty state", () => {
    const html = ssr(<GridPageClient />);
    expect(html).toContain('data-testid="match-tab-placeholder"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Pick your squad");
  });

  it("analysis renders the loading placeholder, not the empty picker", () => {
    const html = ssr(<AnalysisPageClient />);
    expect(html).toContain('data-testid="match-tab-placeholder"');
    expect(html).not.toContain("Squad 1");
  });
});
