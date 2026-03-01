import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpeedAccuracyChart } from "@/components/scatter-chart";
import type { CompareResponse } from "@/lib/types";

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
  archetypePerformance: {},
  courseLengthPerformance: {},
  constraintPerformance: {},
  consistencyStats: {
    1: { coefficientOfVariation: null, label: null, stagesFired: 1 },
    2: { coefficientOfVariation: null, label: null, stagesFired: 1 },
  },
  competitors: [
    {
      id: 1,
      name: "Alice Smith",
      competitor_number: "35",
      club: null,
      division: "Open Major",
    },
    {
      id: 2,
      name: "Bob Jones",
      competitor_number: "50",
      club: null,
      division: "Production Minor",
    },
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
      },
    },
  ],
};

describe("SpeedAccuracyChart", () => {
  it("renders without crashing with valid data", () => {
    const { container } = render(<SpeedAccuracyChart data={baseData} />);
    expect(container).toBeTruthy();
  });

  it("shows empty state when all stages are DNF", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], dnf: true },
            2: { ...baseData.stages[0].competitors[2], dnf: true },
          },
        },
      ],
    };
    render(<SpeedAccuracyChart data={data} />);
    expect(screen.getByText("No scored stages to display.")).toBeInTheDocument();
  });

  it("shows empty state when all stages are zeroed", () => {
    const data: CompareResponse = {
      ...baseData,
      stages: [
        {
          ...baseData.stages[0],
          competitors: {
            1: { ...baseData.stages[0].competitors[1], zeroed: true },
            2: { ...baseData.stages[0].competitors[2], zeroed: true },
          },
        },
      ],
    };
    render(<SpeedAccuracyChart data={data} />);
    expect(screen.getByText("No scored stages to display.")).toBeInTheDocument();
  });

  it("renders the recharts container when there is valid data", () => {
    const { container } = render(<SpeedAccuracyChart data={baseData} />);
    // ResponsiveContainer renders a div wrapper even in jsdom
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
  });
});
