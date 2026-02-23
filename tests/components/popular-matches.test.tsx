import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PopularMatches } from "@/components/popular-matches";
import type { PopularMatch } from "@/lib/types";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock usePopularMatchesQuery
vi.mock("@/lib/queries", () => ({
  usePopularMatchesQuery: vi.fn(),
}));

// Mock competition-store so useSyncExternalStore resolves to an empty list
// (no recents → no deduplication filtering in these tests)
vi.mock("@/lib/competition-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/competition-store")>();
  return {
    ...actual,
    getRecentCompetitionsSnapshot: vi.fn().mockReturnValue([]),
  };
});

import { usePopularMatchesQuery } from "@/lib/queries";

const mockUsePopularMatchesQuery = vi.mocked(usePopularMatchesQuery);

const sampleMatches: PopularMatch[] = [
  {
    ct: "22",
    id: "26547",
    name: "Regional Open 2025",
    venue: "Main Range",
    date: "2025-04-15T09:00:00+00:00",
    scoring_completed: 100,
  },
  {
    ct: "22",
    id: "99001",
    name: "Spring Invitational",
    venue: null,
    date: null,
    scoring_completed: 60,
  },
];

describe("PopularMatches", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders nothing when the popular list is empty", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    const { container } = render(<PopularMatches />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when redis is unavailable (undefined data)", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    const { container } = render(<PopularMatches />);
    expect(container.firstChild).toBeNull();
  });

  it("shows skeleton placeholders while loading", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(screen.getByText("Popular")).toBeInTheDocument();
    // Skeletons are rendered as divs — verify the heading and section are present
    expect(screen.getByRole("region", { name: /popular/i })).toBeInTheDocument();
  });

  it("renders popular match cards with data", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: sampleMatches,
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(screen.getByText("Regional Open 2025")).toBeInTheDocument();
    expect(screen.getByText("Spring Invitational")).toBeInTheDocument();
  });

  it("shows 'Popular' section heading", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: sampleMatches,
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(screen.getByText("Popular")).toBeInTheDocument();
  });

  it("shows scoring percentage on each card", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: sampleMatches,
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("shows venue when present", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: [sampleMatches[0]],
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(screen.getByText(/Main Range/)).toBeInTheDocument();
  });

  it("navigates to match page on card click", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: [sampleMatches[0]],
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    const btn = screen.getByRole("button", { name: /open regional open 2025/i });
    btn.click();
    expect(mockPush).toHaveBeenCalledWith("/match/22/26547");
  });

  it("excludes remove button on popular cards", () => {
    mockUsePopularMatchesQuery.mockReturnValue({
      data: sampleMatches,
      isLoading: false,
    } as ReturnType<typeof usePopularMatchesQuery>);

    render(<PopularMatches />);
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
