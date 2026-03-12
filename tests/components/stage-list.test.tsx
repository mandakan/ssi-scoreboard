import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageList } from "@/components/stage-list";
import type { StageInfo } from "@/lib/types";

const baseStages: StageInfo[] = [
  {
    id: 1,
    name: "Long Shot Stage",
    stage_number: 1,
    max_points: 80,
    min_rounds: 16,
    paper_targets: 8,
    steel_targets: 0,
    ssi_url: "https://shootnscoreit.com/event/stage/24/1/",
    course_display: "Medium",
    procedure: null,
    firearm_condition: null,
  },
  {
    id: 2,
    name: "Speed Stage",
    stage_number: 2,
    max_points: 60,
    min_rounds: 12,
    paper_targets: 6,
    steel_targets: 2,
    ssi_url: "https://shootnscoreit.com/event/stage/24/2/",
    course_display: "Short",
    procedure: null,
    firearm_condition: null,
  },
  {
    id: 3,
    name: "No Data Stage",
    stage_number: 3,
    max_points: 100,
    min_rounds: null,
    paper_targets: null,
    steel_targets: null,
    ssi_url: null,
    course_display: null,
    procedure: null,
    firearm_condition: null,
  },
];

describe("StageList", () => {
  it("renders toggle button with stage count", () => {
    render(<StageList stages={baseStages} />);
    expect(screen.getByRole("button", { name: /stages \(3\)/i })).toBeInTheDocument();
  });

  it("is collapsed by default — stage names not visible", () => {
    render(<StageList stages={baseStages} />);
    expect(screen.queryByText("Long Shot Stage")).not.toBeInTheDocument();
  });

  it("expands when toggle button is clicked", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    expect(screen.getByText("Long Shot Stage")).toBeInTheDocument();
    expect(screen.getByText("Speed Stage")).toBeInTheDocument();
    expect(screen.getByText("No Data Stage")).toBeInTheDocument();
  });

  it("button has aria-expanded=false when collapsed", () => {
    render(<StageList stages={baseStages} />);
    const btn = screen.getByRole("button", { name: /stages \(3\)/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("button has aria-expanded=true when expanded", () => {
    render(<StageList stages={baseStages} />);
    const btn = screen.getByRole("button", { name: /stages \(3\)/i });
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses again when toggle is clicked a second time", () => {
    render(<StageList stages={baseStages} />);
    const btn = screen.getByRole("button", { name: /stages \(3\)/i });
    fireEvent.click(btn);
    expect(screen.getByText("Long Shot Stage")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("Long Shot Stage")).not.toBeInTheDocument();
  });

  it("shows SSI link when ssi_url is present", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    const link = screen.getByRole("link", { name: /long shot stage.*shootnscoreit/i });
    expect(link).toHaveAttribute("href", "https://shootnscoreit.com/event/stage/24/1/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not show SSI link when ssi_url is null", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    // Stage 3 has no ssi_url — no link for it
    expect(
      screen.queryByRole("link", { name: /no data stage.*shootnscoreit/i })
    ).not.toBeInTheDocument();
  });

  it("shows max points for each stage", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    expect(screen.getByText("80 pts")).toBeInTheDocument();
    expect(screen.getByText("60 pts")).toBeInTheDocument();
    expect(screen.getByText("100 pts")).toBeInTheDocument();
  });

  it("shows round count when min_rounds is present", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    expect(screen.getByText("16 rds")).toBeInTheDocument();
    expect(screen.getByText("12 rds")).toBeInTheDocument();
  });

  it("shows paper target count when present", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    expect(screen.getByText("8 paper")).toBeInTheDocument();
    expect(screen.getByText("6 paper")).toBeInTheDocument();
  });

  it("shows steel target count only when > 0", () => {
    render(<StageList stages={baseStages} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(3\)/i }));
    // Stage 2 has 2 steel targets
    expect(screen.getByText("2 steel")).toBeInTheDocument();
    // Stage 1 has 0 steel — should not show
    const allSteel = screen.queryAllByText(/\d+ steel/);
    expect(allSteel).toHaveLength(1);
  });

  it("omits metadata row when all optional fields are null", () => {
    render(<StageList stages={[baseStages[2]]} />);
    fireEvent.click(screen.getByRole("button", { name: /stages \(1\)/i }));
    expect(screen.queryByText(/rds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/paper/)).not.toBeInTheDocument();
    expect(screen.queryByText(/steel/)).not.toBeInTheDocument();
  });

  it("renders nothing when stages array is empty", () => {
    const { container } = render(<StageList stages={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
