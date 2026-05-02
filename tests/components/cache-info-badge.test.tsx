import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CacheInfoBadge } from "@/components/cache-info-badge";

function withQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("CacheInfoBadge — sync vs data freshness", () => {
  const FIXED_NOW = new Date("2026-05-02T09:30:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("during a healthy live phase, surfaces both sync time and last new data when scorecard activity is quiet", () => {
    // Synced 10s ago, last shot landed 8 minutes ago — match is mid-shoot
    // but the watched shooter / squad is on a break. Users should see this
    // as "we're in sync, the upstream is just quiet" — no warning.
    const cachedAt = new Date(FIXED_NOW - 10_000).toISOString();
    const lastScorecardAt = new Date(FIXED_NOW - 8 * 60_000).toISOString();
    render(
      withQuery(
        <CacheInfoBadge
          ct="22"
          id="27190"
          cachedAt={cachedAt}
          lastScorecardAt={lastScorecardAt}
          phase="live"
        />,
      ),
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Synced 10s ago");
    expect(button.textContent).toContain("last data 8m ago");
  });

  it("collapses the secondary label to 'data fresh' when the latest scorecard arrived under a minute ago", () => {
    const cachedAt = new Date(FIXED_NOW - 5_000).toISOString();
    const lastScorecardAt = new Date(FIXED_NOW - 20_000).toISOString();
    render(
      withQuery(
        <CacheInfoBadge
          ct="22"
          id="27190"
          cachedAt={cachedAt}
          lastScorecardAt={lastScorecardAt}
          phase="live"
        />,
      ),
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Synced 5s ago");
    expect(button.textContent).toContain("data fresh");
  });

  it("drops the data sub-label when sync is in warning state — the sync issue is what matters", () => {
    // Sync is 4 minutes stale (warning threshold = 3 min). Don't dilute the
    // amber escalation by appending an old-data note.
    const cachedAt = new Date(FIXED_NOW - 4 * 60_000).toISOString();
    const lastScorecardAt = new Date(FIXED_NOW - 8 * 60_000).toISOString();
    render(
      withQuery(
        <CacheInfoBadge
          ct="22"
          id="27190"
          cachedAt={cachedAt}
          lastScorecardAt={lastScorecardAt}
          phase="live"
        />,
      ),
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Updated 4m ago");
    expect(button.textContent).not.toContain("last data");
    expect(button.textContent).not.toContain("data fresh");
  });

  it("drops the data sub-label outside the live phase", () => {
    // Pre-match / finished phases don't have a scoring loop, so a "last
    // data" hint adds no value — keep the badge simple.
    const cachedAt = new Date(FIXED_NOW - 30_000).toISOString();
    const lastScorecardAt = new Date(FIXED_NOW - 8 * 60_000).toISOString();
    render(
      withQuery(
        <CacheInfoBadge
          ct="22"
          id="27190"
          cachedAt={cachedAt}
          lastScorecardAt={lastScorecardAt}
          phase="finished"
        />,
      ),
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Updated 30s ago");
    expect(button.textContent).not.toContain("last data");
  });

  it("renders only the sync label when no scorecards exist yet", () => {
    // Pre-match start, or all squads on coffee with zero scorecards entered.
    // No lastScorecardAt → no second label.
    const cachedAt = new Date(FIXED_NOW - 12_000).toISOString();
    render(
      withQuery(
        <CacheInfoBadge
          ct="22"
          id="27190"
          cachedAt={cachedAt}
          lastScorecardAt={null}
          phase="live"
        />,
      ),
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Synced 12s ago");
    expect(button.textContent).not.toContain("·");
  });
});
