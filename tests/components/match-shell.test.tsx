import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResponse } from "@/lib/types";

const useMatchQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useMatchQuery: (...a: unknown[]) => useMatchQuery(...a) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/match/22/1" }));
vi.mock("@/lib/competition-store", () => ({ saveRecentCompetition: () => () => {} }));

import { MatchShell } from "@/components/match-shell";

function setMatch(over: Partial<MatchResponse>) {
  useMatchQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    isFetching: false,
    data: {
      name: "Shell Match",
      scoring_pct: 40,
      match_status: "on",
      results_status: "stg",
      cacheInfo: { cachedAt: null },
      ...over,
    } as MatchResponse,
  });
}

function renderShell() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchShell ct="22" id="1"><p>child</p></MatchShell>
    </QueryClientProvider>,
  );
}

describe("TopBar match notice", () => {
  beforeEach(() => useMatchQuery.mockReset());

  it("is absent when results are merely unpublished", () => {
    setMatch({});
    renderShell();
    expect(screen.queryByRole("link", { name: "Match notice" })).toBeNull();
  });

  it("shows for a cancelled match and links to Info without prefetch", () => {
    setMatch({ match_status: "cs" });
    renderShell();
    const link = screen.getByRole("link", { name: "Match notice" });
    expect(link).toHaveAttribute("href", "/match/22/1/info");
  });

  it("shows when upstream is degraded", () => {
    setMatch({ cacheInfo: { cachedAt: null, upstreamDegraded: true } });
    renderShell();
    expect(screen.getByRole("link", { name: "Match notice" })).toBeInTheDocument();
  });

  it("shows when upstream is paused", () => {
    setMatch({ cacheInfo: { cachedAt: null, upstreamPaused: true } });
    renderShell();
    expect(screen.getByRole("link", { name: "Match notice" })).toBeInTheDocument();
  });
});
