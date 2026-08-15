import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpstreamStatusBanner } from "@/components/upstream-status-banner";
import { useUpstreamStatusQuery } from "@/lib/queries";

vi.mock("@/lib/queries", () => ({
  useUpstreamStatusQuery: vi.fn(),
}));

const mockStatus = (data: { degraded: boolean; paused: boolean; since: string | null } | undefined) => {
  vi.mocked(useUpstreamStatusQuery).mockReturnValue(
    { data } as ReturnType<typeof useUpstreamStatusQuery>,
  );
};

describe("UpstreamStatusBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when healthy", () => {
    mockStatus({ degraded: false, paused: false, since: null });
    const { container } = render(<UpstreamStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while status is loading", () => {
    mockStatus(undefined);
    const { container } = render(<UpstreamStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows outage copy when degraded and not paused", () => {
    mockStatus({ degraded: true, paused: false, since: "2026-08-15T08:00:00Z" });
    render(<UpstreamStatusBanner />);
    expect(screen.getByText("ShootNScoreIt is having trouble")).toBeInTheDocument();
  });

  it("shows deliberate-pause copy when paused, even without a degraded flag", () => {
    mockStatus({ degraded: false, paused: true, since: null });
    render(<UpstreamStatusBanner />);
    expect(screen.getByText(/temporarily paused/i)).toBeInTheDocument();
    expect(screen.queryByText("ShootNScoreIt is having trouble")).not.toBeInTheDocument();
  });

  it("prefers pause copy when both paused and degraded", () => {
    mockStatus({ degraded: true, paused: true, since: "2026-08-15T08:00:00Z" });
    render(<UpstreamStatusBanner />);
    expect(screen.getByText(/temporarily paused/i)).toBeInTheDocument();
    expect(screen.queryByText("ShootNScoreIt is having trouble")).not.toBeInTheDocument();
  });
});
