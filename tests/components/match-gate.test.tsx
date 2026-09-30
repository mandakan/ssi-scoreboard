import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MatchResponse } from "@/lib/types";

const useMatchQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useMatchQuery: (...a: unknown[]) => useMatchQuery(...a) }));

import { MatchGate, useMatch } from "@/components/match-gate";

function Probe() {
  const { match, ct, id, stale } = useMatch();
  return <p>{`${ct}/${id}: ${match.name}`}<span data-testid="stale">{String(stale)}</span></p>;
}

function renderGate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchGate ct="22" id="1"><Probe /></MatchGate>
    </QueryClientProvider>,
  );
}

describe("MatchGate", () => {
  it("shows a loading state, not children, while loading", () => {
    useMatchQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderGate();
    expect(screen.getByTestId("match-gate-loading")).toBeInTheDocument();
    expect(screen.queryByText(/22\/1/)).toBeNull();
  });

  it("announces the loading state as a busy status", () => {
    useMatchQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderGate();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading match");
  });

  it("renders children with the loaded match", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: false, isFetching: false,
      data: { name: "Test Match" } as MatchResponse,
    });
    renderGate();
    expect(screen.getByText("22/1: Test Match")).toBeInTheDocument();
  });

  it("shows the not-viewable copy as an alert on a 404", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, data: undefined,
      error: new Error("Match fetch failed (404): nope"),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "Match not viewable" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps rendering children when a background refetch fails but data exists", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, isFetching: false,
      data: { name: "Test Match" } as MatchResponse,
      error: new Error("Match fetch failed (502): upstream"),
    });
    renderGate();
    expect(screen.getByText("22/1: Test Match")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("stale")).toHaveTextContent("refresh-failed");
  });

  it("words a mid-session 404 as no longer viewable, keeping the data", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, isFetching: false,
      data: { name: "Test Match" } as MatchResponse,
      error: new Error("Match fetch failed (404): gone"),
    });
    renderGate();
    expect(screen.getByText("22/1: Test Match")).toBeInTheDocument();
    expect(screen.getByTestId("stale")).toHaveTextContent("gone");
  });

  it("shows no stale notice when the query succeeds", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: false, isFetching: false,
      data: { name: "Test Match" } as MatchResponse,
    });
    renderGate();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("stale")).toHaveTextContent("null");
  });

  it("shows the generic failure copy on a non-404", () => {
    useMatchQuery.mockReturnValue({
      isLoading: false, isError: true, data: undefined,
      error: new Error("Match fetch failed (502): upstream"),
    });
    renderGate();
    expect(screen.getByRole("heading", { name: "Failed to load match" })).toBeInTheDocument();
  });

  it("useMatch throws outside a gate", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/MatchGate/);
    err.mockRestore();
  });
});
