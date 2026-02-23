import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentCompetitions } from "@/components/recent-competitions";
import type { StoredCompetition } from "@/lib/competition-store";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock only the I/O-bound functions; keep the rest (subscribeRecent, etc.) real
// by using importOriginal so useSyncExternalStore in the component gets a valid subscribe fn.
vi.mock("@/lib/competition-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/competition-store")>();
  return {
    ...actual,
    getRecentCompetitionsSnapshot: vi.fn(),
    removeRecentCompetition: vi.fn(),
  };
});

import {
  getRecentCompetitionsSnapshot,
  removeRecentCompetition,
} from "@/lib/competition-store";

const mockGetSnapshot = vi.mocked(getRecentCompetitionsSnapshot);
const mockRemove = vi.mocked(removeRecentCompetition);

const sampleCompetitions: StoredCompetition[] = [
  {
    ct: "22",
    id: "26547",
    name: "Punishment Winter Challenge",
    venue: "Test Range",
    date: "2025-03-01",
    scoring_completed: 75,
    last_visited: Date.now(),
  },
  {
    ct: "22",
    id: "12345",
    name: "Spring Cup 2025",
    venue: null,
    date: null,
    scoring_completed: 100,
    last_visited: Date.now() - 1000,
  },
];

describe("RecentCompetitions", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRemove.mockClear();
  });

  it("shows empty state when no recent competitions", () => {
    mockGetSnapshot.mockReturnValue([]);
    render(<RecentCompetitions />);
    expect(
      screen.getByText(/your recently viewed competitions will appear here/i)
    ).toBeInTheDocument();
  });

  it("renders competition cards", () => {
    mockGetSnapshot.mockReturnValue(sampleCompetitions);
    render(<RecentCompetitions />);
    expect(screen.getByText("Punishment Winter Challenge")).toBeInTheDocument();
    expect(screen.getByText("Spring Cup 2025")).toBeInTheDocument();
  });

  it("shows scoring percentage", () => {
    mockGetSnapshot.mockReturnValue(sampleCompetitions);
    render(<RecentCompetitions />);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("navigates to match page on card click", () => {
    mockGetSnapshot.mockReturnValue([sampleCompetitions[0]]);
    render(<RecentCompetitions />);
    fireEvent.click(screen.getByRole("button", { name: /open punishment winter challenge/i }));
    expect(mockPush).toHaveBeenCalledWith("/match/22/26547");
  });

  it("removes competition and updates list on remove click", () => {
    mockGetSnapshot.mockReturnValue([...sampleCompetitions]);
    render(<RecentCompetitions />);
    const removeBtn = screen.getByRole("button", {
      name: /remove punishment winter challenge/i,
    });
    fireEvent.click(removeBtn);
    expect(mockRemove).toHaveBeenCalledWith("22", "26547");
  });

  it("shows 'My recents' heading when items exist", () => {
    mockGetSnapshot.mockReturnValue(sampleCompetitions);
    render(<RecentCompetitions />);
    expect(screen.getByText("My recents")).toBeInTheDocument();
  });

  it("shows venue and date when present", () => {
    mockGetSnapshot.mockReturnValue([sampleCompetitions[0]]);
    render(<RecentCompetitions />);
    expect(screen.getByText(/Test Range/)).toBeInTheDocument();
  });
});
