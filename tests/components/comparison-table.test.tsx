import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ComparisonTable } from "@/components/comparison-table";
import type { CompareResponse } from "@/lib/types";

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const baseData: CompareResponse = {
  match_id: 26547,
  competitors: [
    { id: 1, name: "Alice Smith", competitor_number: "35", club: null, division: "Open Major" },
    { id: 2, name: "Bob Jones", competitor_number: "50", club: null, division: "Production Minor" },
  ],
  stages: [
    {
      stage_id: 100,
      stage_name: "Stage One",
      stage_num: 1,
      max_points: 80,
      ssi_url: "https://shootnscoreit.com/event/stage/24/100/",
      group_leader_hf: 5.63,
      group_leader_points: 76,
      overall_leader_hf: 5.63,
      competitors: {
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
          dq: false,
          zeroed: false,
          dnf: false,
          a_hits: null,
          c_hits: null,
          d_hits: null,
          miss_count: null,
          no_shoots: null,
          procedurals: null,
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
          dq: false,
          zeroed: false,
          dnf: false,
          a_hits: null,
          c_hits: null,
          d_hits: null,
          miss_count: null,
          no_shoots: null,
          procedurals: null,
        },
      },
    },
  ],
};

describe("ComparisonTable", () => {
  it("renders competitor names", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders stage name", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByText("Stage One")).toBeInTheDocument();
  });

  it("renders hit factors as primary metric", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getAllByText("5.02").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5.63").length).toBeGreaterThan(0);
  });

  it("renders DNF badge for dnf stages", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: {
              ...baseData.stages[0].competitors[1],
              dnf: true,
              hit_factor: null,
              points: null,
            },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getByText("DNF")).toBeInTheDocument();
  });

  it("renders em-dash for stages with no scorecard", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            // competitor 2 only — no scorecard for competitor 1
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders DQ badge for disqualified competitor", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dq: true },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getByText("DQ")).toBeInTheDocument();
  });

  it("renders match-level DQ banner when all stages for a competitor are DQ", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dq: true },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("— Disqualified from match")).toBeInTheDocument();
  });

  it("does not render match-level DQ banner when only some stages are DQ", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dq: true },
            2: baseData.stages[0].competitors[2],
          },
        },
        {
          stage_id: 101,
          stage_name: "Stage Two",
          stage_num: 2,
          max_points: 60,
          group_leader_hf: 4.0,
          group_leader_points: 58,
          overall_leader_hf: 4.0,
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dq: false },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders totals row with total points", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByText("Total pts")).toBeInTheDocument();
    expect(screen.getAllByText("72").length).toBeGreaterThan(0);
    expect(screen.getAllByText("76").length).toBeGreaterThan(0);
  });

  it("renders mode toggle buttons", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByText("Group")).toBeInTheDocument();
    expect(screen.getByText("Division")).toBeInTheDocument();
    expect(screen.getByText("Overall")).toBeInTheDocument();
  });

  it("renders SSI stage link when ssi_url is present", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    const link = screen.getByRole("link", { name: /stage one.*shootnscoreit/i });
    expect(link).toHaveAttribute("href", "https://shootnscoreit.com/event/stage/24/100/");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders plain text stage label when ssi_url is absent", () => {
    const dataNoUrl = {
      ...baseData,
      stages: [{ ...baseData.stages[0], ssi_url: undefined }],
    };
    renderWithProviders(<ComparisonTable data={dataNoUrl} />);
    expect(screen.queryByRole("link", { name: /stage one.*shootnscoreit/i })).not.toBeInTheDocument();
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
  });

  it("renders stage metadata row when min_rounds and paper_targets are present", () => {
    const dataWithMeta = {
      ...baseData,
      stages: [{ ...baseData.stages[0], min_rounds: 16, paper_targets: 8, steel_targets: 0 }],
    };
    renderWithProviders(<ComparisonTable data={dataWithMeta} />);
    expect(screen.getByText("16 rds · 8 paper")).toBeInTheDocument();
  });

  it("omits metadata row when all optional fields are absent", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.queryByText(/rds/)).not.toBeInTheDocument();
  });
});

describe("ComparisonTable — penalty badge", () => {
  function makeDataWithPenalties(
    penaltiesComp1: { miss_count: number; no_shoots: number; procedurals: number },
    penaltiesComp2: { miss_count: number; no_shoots: number; procedurals: number }
  ): CompareResponse {
    return {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], ...penaltiesComp1 },
            2: { ...baseData.stages[0].competitors[2], ...penaltiesComp2 },
          },
        },
      ],
    };
  }

  it("hides penalty badge when all penalties are explicitly zero", () => {
    const data = makeDataWithPenalties(
      { miss_count: 0, no_shoots: 0, procedurals: 0 },
      { miss_count: 0, no_shoots: 0, procedurals: 0 }
    );
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.queryByText(/\u2212\d+pts/)).not.toBeInTheDocument();
  });

  it("shows penalty badge with correct total when miss penalties exist", () => {
    // 2 misses + 1 no-shoot = 30 pts penalty
    const data = makeDataWithPenalties(
      { miss_count: 2, no_shoots: 1, procedurals: 0 },
      { miss_count: 0, no_shoots: 0, procedurals: 0 }
    );
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getAllByText("\u221230pts").length).toBeGreaterThan(0);
  });

  it("shows penalty badge for procedurals only", () => {
    const data = makeDataWithPenalties(
      { miss_count: 0, no_shoots: 0, procedurals: 2 },
      { miss_count: 0, no_shoots: 0, procedurals: 0 }
    );
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getAllByText("\u221220pts").length).toBeGreaterThan(0);
  });

  it("shows clean match indicator in totals row when all stages have zero penalties", () => {
    const data = makeDataWithPenalties(
      { miss_count: 0, no_shoots: 0, procedurals: 0 },
      { miss_count: 0, no_shoots: 0, procedurals: 0 }
    );
    renderWithProviders(<ComparisonTable data={data} />);
    expect(screen.getAllByText("✓ Clean").length).toBeGreaterThan(0);
  });

  it("hides clean match indicator when penalties exist", () => {
    const data = makeDataWithPenalties(
      { miss_count: 1, no_shoots: 0, procedurals: 0 },
      { miss_count: 0, no_shoots: 0, procedurals: 0 }
    );
    renderWithProviders(<ComparisonTable data={data} />);
    // Only competitor 2 (all zeros) should be clean
    expect(screen.getAllByText("✓ Clean").length).toBe(1);
  });

  it("does not show clean match indicator when penalty data is null (unknown)", () => {
    // baseData has all nulls — no penalty data available, so we can't confirm clean
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.queryByText("✓ Clean")).not.toBeInTheDocument();
  });
});
