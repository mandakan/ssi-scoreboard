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
    { id: 1, name: "Alice Smith", competitor_number: "35", club: null, division: "hg1" },
    { id: 2, name: "Bob Jones", competitor_number: "50", club: null, division: "hg3" },
  ],
  stages: [
    {
      stage_id: 100,
      stage_name: "Stage One",
      stage_num: 1,
      max_points: 80,
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

  it("renders em-dash for dnf/not-fired stages", () => {
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
});
