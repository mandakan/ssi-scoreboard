import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComparisonChart } from "@/components/comparison-chart";
import type { CompareResponse } from "@/lib/types";

const baseCompetitors = [
  { id: 1, name: "Alice Smith", competitor_number: "35", club: null, division: "Open Major" },
  { id: 2, name: "Bob Jones", competitor_number: "50", club: null, division: "Production Minor" },
];

const baseStageCompetitors = {
  1: {
    competitor_id: 1,
    points: 72,
    hit_factor: 5.02,
    time: 14.34,
    group_rank: 2,
    group_percent: 89.2,
    div_rank: 1,
    div_percent: 100,
    overall_rank: 2,
    overall_percent: 89.2,
    overall_percentile: 0.0,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: null,
    c_hits: null,
    d_hits: null,
    miss_count: null,
    no_shoots: null,
    procedurals: null,
    stageClassification: null,
    hitLossPoints: null,
    penaltyLossPoints: 0,
  },
  2: {
    competitor_id: 2,
    points: 76,
    hit_factor: 5.63,
    time: 13.49,
    group_rank: 1,
    group_percent: 100,
    div_rank: 1,
    div_percent: 100,
    overall_rank: 1,
    overall_percent: 100,
    overall_percentile: 1.0,
    dq: false,
    zeroed: false,
    dnf: false,
    incomplete: false,
    a_hits: null,
    c_hits: null,
    d_hits: null,
    miss_count: null,
    no_shoots: null,
    procedurals: null,
    stageClassification: null,
    hitLossPoints: null,
    penaltyLossPoints: 0,
  },
};

const baseData: CompareResponse = {
  match_id: 26547,
  cacheInfo: { cachedAt: null },
  penaltyStats: {
    1: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 100, matchPctClean: 100, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
    2: { totalPenalties: 0, penaltyCostPercent: 0, matchPctActual: 80, matchPctClean: 80, penaltiesPerStage: 0, penaltiesPer100Rounds: 0 },
  },
  efficiencyStats: {},
  lossBreakdownStats: {},
  whatIfStats: {},
  styleFingerprintStats: {},
  fieldFingerprintPoints: [],
  consistencyStats: {
    1: { coefficientOfVariation: null, label: null, stagesFired: 1 },
    2: { coefficientOfVariation: null, label: null, stagesFired: 1 },
  },
  competitors: baseCompetitors,
  stages: [
    {
      stage_id: 100,
      stage_name: "Stage One",
      stage_num: 1,
      max_points: 80,
      group_leader_hf: 5.63,
      group_leader_points: 76,
      overall_leader_hf: 6.1,
      field_median_hf: 4.0,
      field_competitor_count: 50,
      stageDifficultyLevel: 3,
      stageDifficultyLabel: "hard",
      competitors: baseStageCompetitors,
    },
  ],
};

const dataNoLeader: CompareResponse = {
  ...baseData,
  stages: [{ ...baseData.stages[0], overall_leader_hf: null }],
};

describe("ComparisonChart — benchmark toggle", () => {
  it("renders without crashing", () => {
    const { container } = render(<ComparisonChart data={baseData} />);
    expect(container).toBeTruthy();
  });

  it("shows Field leader button when overall_leader_hf data is present", () => {
    render(<ComparisonChart data={baseData} />);
    expect(screen.getByRole("button", { name: /field leader/i })).toBeInTheDocument();
  });

  it("hides Field leader button when all overall_leader_hf values are null", () => {
    render(<ComparisonChart data={dataNoLeader} />);
    expect(screen.queryByRole("button", { name: /field leader/i })).not.toBeInTheDocument();
  });

  it("Field leader button starts not pressed by default", () => {
    render(<ComparisonChart data={baseData} />);
    const btn = screen.getByRole("button", { name: /field leader/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("Field leader button starts pressed when showBenchmark=true", () => {
    render(<ComparisonChart data={baseData} showBenchmark />);
    const btn = screen.getByRole("button", { name: /field leader/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking Field leader button toggles aria-pressed", () => {
    render(<ComparisonChart data={baseData} />);
    const btn = screen.getByRole("button", { name: /field leader/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ComparisonChart — competitor toggles", () => {
  it("renders a toggle button for each competitor", () => {
    render(<ComparisonChart data={baseData} />);
    expect(screen.getByRole("button", { name: /#35 Alice/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /#50 Bob/i })).toBeInTheDocument();
  });

  it("competitor buttons start pressed", () => {
    render(<ComparisonChart data={baseData} />);
    const aliceBtn = screen.getByRole("button", { name: /#35 Alice/i });
    expect(aliceBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a competitor button toggles it off then on", () => {
    render(<ComparisonChart data={baseData} />);
    const aliceBtn = screen.getByRole("button", { name: /#35 Alice/i });
    fireEvent.click(aliceBtn);
    expect(aliceBtn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(aliceBtn);
    expect(aliceBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the recharts container", () => {
    const { container } = render(<ComparisonChart data={baseData} />);
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });
});
