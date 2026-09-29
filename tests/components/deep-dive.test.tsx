import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { CompareResponse, MatchResponse } from "@/lib/types";

const useCompareQuery = vi.fn();
vi.mock("@/lib/queries", () => ({ useCompareQuery: (...a: unknown[]) => useCompareQuery(...a) }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));
vi.mock("@/components/course-performance", () => ({ CourseLengthSummary: () => <p>course</p>, ConstraintSummary: () => <p>constraints</p> }));
vi.mock("@/components/archetype-performance", () => ({ ArchetypePerformanceSummary: () => <p>archetypes</p> }));
vi.mock("@/components/style-fingerprint-chart", () => ({ StyleFingerprintChart: () => <p>fingerprint</p> }));
vi.mock("@/components/shooter-style-radar-chart", () => ({ ShooterStyleRadarChart: () => <p>style</p> }));
vi.mock("@/components/stage-degradation-chart", () => ({ StageDegradationChart: () => <p>degradation</p> }));
vi.mock("@/components/stage-simulator", () => ({ StageSimulator: () => <p>simulator</p> }));
vi.mock("@/components/stage-times-export", () => ({ StageTimesExport: () => <p>export</p> }));

import { DeepDive } from "@/components/analysis/deep-dive";

const match = { scoring_pct: 90, competitors: [] } as unknown as MatchResponse;
const coaching = { competitors: [] } as unknown as CompareResponse;

const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

describe("DeepDive", () => {
  beforeEach(() => {
    useCompareQuery.mockReset().mockReturnValue({ data: undefined, isLoading: false, isError: false });
    trackUi.mockClear();
    scrollIntoView.mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("is collapsed by default and fetches nothing while live and closed", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1, 2]} compareMode="live" coachingData={undefined} />);
    expect(screen.getByRole("button", { name: /deep dive/i })).toHaveAttribute("aria-expanded", "false");
    for (const call of useCompareQuery.mock.calls) expect(call[2]).toEqual([]);
  });

  it("while live, opening fires one coaching-mode query and reports the open", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1, 2]} compareMode="live" coachingData={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    const last = useCompareQuery.mock.calls.at(-1)!;
    expect(last).toEqual(["22", "1", [1, 2], "coaching"]);
    expect(trackUi).toHaveBeenCalledWith({ op: "analysis-section-open", ct: 22, section: "deep-dive" });
  });

  it("while live, never renders the simulator", () => {
    useCompareQuery.mockReturnValue({ data: coaching, isLoading: false, isError: false });
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="live" coachingData={undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    expect(screen.getByText("export")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stage simulator/i })).toBeNull();
  });

  it("when coaching, reuses the page data (no extra query) and offers the simulator at >=80%", () => {
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="coaching" coachingData={coaching} />);
    fireEvent.click(screen.getByRole("button", { name: /deep dive/i }));
    for (const call of useCompareQuery.mock.calls) expect(call[2]).toEqual([]);
    expect(screen.getByText("fingerprint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stage simulator/i })).toBeInTheDocument();
  });

  it("opens and scrolls to the fingerprint block for its anchor, clears the hash, reports the open", async () => {
    window.location.hash = "#chart-style-fingerprint";
    render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="coaching" coachingData={coaching} />);
    expect(screen.getByRole("button", { name: /deep dive/i })).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("chart-style-fingerprint")).not.toBeNull();
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(trackUi).toHaveBeenCalledWith({ op: "analysis-section-open", ct: 22, section: "deep-dive" });
  });

  it("shows a loading skeleton then scrolls once live data arrives via the anchor", async () => {
    window.location.hash = "#chart-style-fingerprint";
    useCompareQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { rerender } = render(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="live" coachingData={undefined} />);
    expect(document.getElementById("chart-style-fingerprint")).toBeNull();
    useCompareQuery.mockReturnValue({ data: coaching, isLoading: false, isError: false });
    rerender(<DeepDive ct="22" id="1" match={match} selectedIds={[1]} compareMode="live" coachingData={undefined} />);
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
