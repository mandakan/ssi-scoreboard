import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpstreamDegradedBanner } from "@/components/upstream-degraded-banner";

describe("UpstreamDegradedBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the heading and an aria-live=polite status region", () => {
    render(<UpstreamDegradedBanner cachedAt={null} />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Live updates paused")).toBeInTheDocument();
  });

  it("includes a relative-time clause when cachedAt is provided", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(<UpstreamDegradedBanner cachedAt={fiveMinAgo} />);
    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
  });

  it("uses singular 'minute' for exactly one minute", () => {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    render(<UpstreamDegradedBanner cachedAt={oneMinAgo} />);
    expect(screen.getByText(/1 minute ago/)).toBeInTheDocument();
    expect(screen.queryByText(/1 minutes ago/)).not.toBeInTheDocument();
  });

  it("falls back to a generic clause when cachedAt is null", () => {
    render(<UpstreamDegradedBanner cachedAt={null} />);
    expect(
      screen.getByText(/Showing the last scores we received before the outage/),
    ).toBeInTheDocument();
  });

  it("renders the warning icon as decorative (aria-hidden)", () => {
    const { container } = render(<UpstreamDegradedBanner cachedAt={null} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
