import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      field_median_hf: 4.0,
      field_competitor_count: 50,
      stageDifficultyLevel: 3,
      stageDifficultyLabel: "hard",
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
          field_median_hf: 4.0,
          field_competitor_count: 50,
          stageDifficultyLevel: 3,
          stageDifficultyLabel: "hard",
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

describe("ComparisonTable — incomplete scorecard indicator", () => {
  it("shows incomplete warning indicator when incomplete=true", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], incomplete: true },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    expect(
      screen.getByLabelText("Incomplete scorecard (rule 9.7.6.2)")
    ).toBeInTheDocument();
  });

  it("does not show incomplete indicator when incomplete=false", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(
      screen.queryByLabelText("Incomplete scorecard (rule 9.7.6.2)")
    ).not.toBeInTheDocument();
  });
});

describe("ComparisonTable — delta view mode", () => {
  it("renders Absolute and Delta toggle buttons", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByRole("button", { name: "Absolute" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delta" })).toBeInTheDocument();
  });

  it("Absolute toggle is pressed by default", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    expect(screen.getByRole("button", { name: "Absolute" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Delta" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to delta mode when Delta button is clicked", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getByRole("button", { name: "Delta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Absolute" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows delta value (leader has ±0.0 pts) in delta mode", () => {
    // Bob is the group leader (group_leader_points = 76, Bob.points = 76 → delta = 0)
    renderWithProviders(<ComparisonTable data={baseData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getAllByText("±0.0 pts").length).toBeGreaterThan(0);
  });

  it("shows negative delta for the non-leader competitor in delta mode", () => {
    // Alice: points=72, leader=76 → delta = -4 → "−4.0 pts"
    renderWithProviders(<ComparisonTable data={baseData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getAllByText("\u22124.0 pts").length).toBeGreaterThan(0);
  });

  it("shows em-dash in delta mode for a competitor with no scorecard", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("still shows DNF badge in delta mode", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dnf: true, hit_factor: null, points: null },
            2: baseData.stages[0].competitors[2],
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={data} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getByText("DNF")).toBeInTheDocument();
  });

  it("still shows DQ badge in delta mode", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getByText("DQ")).toBeInTheDocument();
  });

  it("totals row shows 'Total deficit' label in delta mode", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    expect(screen.getByText("Total deficit")).toBeInTheDocument();
  });

  it("totals row shows cumulative deficit for the non-leader in delta mode", () => {
    // Alice: -4 pts across the 1 stage → total deficit = "−4.0 pts"
    renderWithProviders(<ComparisonTable data={baseData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    // Leader shows ±0.0 pts, non-leader shows −4.0 pts (appears at least once each)
    expect(screen.getAllByText("±0.0 pts").length).toBeGreaterThanOrEqual(2); // per-stage + totals for leader
    expect(screen.getAllByText("\u22124.0 pts").length).toBeGreaterThanOrEqual(2); // per-stage + totals for non-leader
  });

  it("hides % reference toggle in delta mode", () => {
    renderWithProviders(<ComparisonTable data={baseData} />);
    // % toggle visible in absolute mode
    expect(screen.getByText("% relative to:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    // % toggle hidden in delta mode
    expect(screen.queryByText("% relative to:")).not.toBeInTheDocument();
  });

  it("tie case: two competitors with equal points both show ±0.0 pts in delta mode", () => {
    const tieData: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          group_leader_points: 76,
          competitors: {
            1: { ...baseData.stages[0].competitors[1], points: 76 },
            2: { ...baseData.stages[0].competitors[2], points: 76 },
          },
        },
      ],
    };
    renderWithProviders(<ComparisonTable data={tieData} />);
    fireEvent.click(screen.getByRole("button", { name: "Delta" }));
    // Both competitors show ±0.0 pts (per-stage); totals row also shows ±0.0 pts
    expect(screen.getAllByText("±0.0 pts").length).toBeGreaterThanOrEqual(2);
  });
});
