import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CompareResponse } from "@/lib/types";

vi.mock("@/components/comparison-chart", () => ({ ComparisonChart: () => <p>chart:hf-by-stage</p> }));
vi.mock("@/components/hf-percent-chart", () => ({ HfPercentChart: () => <p>chart:hf-pct</p> }));
vi.mock("@/components/division-distribution-chart", () => ({ DivisionDistributionChart: () => <p>chart:division-position</p> }));
vi.mock("@/components/scatter-chart", () => ({ SpeedAccuracyChart: () => <p>chart:speed-accuracy</p> }));
vi.mock("@/components/radar-chart", () => ({ StageBalanceChart: () => <p>chart:stage-balance</p> }));
const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (e: unknown) => trackUi(e) }));

import { ChartsCard } from "@/components/analysis/charts-card";

const data = { stages: [{ divisionDistributions: {} }] } as unknown as CompareResponse;
const props = { data, stages: [], sortedCompName: null, careerBaselineHF: null, careerBaselinePct: null, ct: "22" };

describe("ChartsCard", () => {
  beforeEach(() => { localStorage.clear(); trackUi.mockClear(); });

  it("mounts only the first available chart by default", async () => {
    render(<ChartsCard {...props} />);
    expect(await screen.findByText("chart:hf-by-stage")).toBeInTheDocument();
    expect(screen.queryByText("chart:hf-pct")).toBeNull();
    expect(screen.queryByRole("button", { name: "Division" })).toBeNull();
  });

  it("switches chart, remembers it, and reports the switch", async () => {
    render(<ChartsCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Balance" }));
    expect(await screen.findByText("chart:stage-balance")).toBeInTheDocument();
    expect(screen.queryByText("chart:hf-by-stage")).toBeNull();
    expect(screen.getByRole("button", { name: "Balance" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("ssi-analysis-chart")).toBe("stage-balance");
    expect(trackUi).toHaveBeenCalledWith({ op: "chart-switch", ct: 22, chart: "stage-balance" });
  });

  it("restores a stored choice and falls back when unavailable", async () => {
    localStorage.setItem("ssi-analysis-chart", "division-position");
    render(<ChartsCard {...props} />);
    expect(await screen.findByText("chart:hf-by-stage")).toBeInTheDocument();
  });

  it("titles the card and its help button after the selected chart", async () => {
    render(<ChartsCard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "HF %" }));
    expect(await screen.findByRole("heading", { name: /HF% vs stage winner/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About HF% vs stage winner" })).toBeInTheDocument();
  });
});
