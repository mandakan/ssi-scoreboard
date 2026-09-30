import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResponse } from "@/lib/types";

const useMatchQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useMatchQuery: (...a: unknown[]) => useMatchQuery(...a) }));
const linkProps: Array<Record<string, unknown>> = [];
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => {
    linkProps.push(props);
    return <a href={props.href as string} aria-label={props["aria-label"] as string | undefined}>{children}</a>;
  },
}));
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

function setStale(message: string) {
  useMatchQuery.mockReturnValue({
    isLoading: false,
    isError: true,
    isFetching: false,
    error: new Error(message),
    data: {
      name: "Shell Match",
      scoring_pct: 40,
      match_status: "on",
      results_status: "stg",
      cacheInfo: { cachedAt: null },
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
  beforeEach(() => {
    useMatchQuery.mockReset();
    linkProps.length = 0;
  });

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
    const props = linkProps.find((p) => p["aria-label"] === "Match notice");
    expect(props?.prefetch).toBe(false);
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

describe("TopBar stale chip", () => {
  beforeEach(() => useMatchQuery.mockReset());

  it("is absent on success and keeps the scoring percent", () => {
    setMatch({});
    renderShell();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("40 percent scored")).toBeInTheDocument();
  });

  it("shows Not updating with a full sentence when a refresh failed", () => {
    setStale("Match fetch failed (502): x");
    renderShell();
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("Not updating");
    expect(chip).toHaveTextContent("Could not refresh match data. Showing the last loaded update.");
    expect(screen.queryByLabelText("40 percent scored")).toBeNull();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("shows Unavailable when the match is gone", () => {
    setStale("Match fetch failed (404): x");
    renderShell();
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("Unavailable");
    expect(chip).toHaveTextContent("This match is no longer viewable. Showing the last loaded data.");
  });
});
