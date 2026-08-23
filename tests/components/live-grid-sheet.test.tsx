import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveGridSheet } from "@/components/live-grid-sheet";
import type {
  LiveGridCell,
  LiveGridShooter,
  LiveGridStage,
} from "@/lib/types";

const SHOOTER: LiveGridShooter = {
  id: 1,
  shooterId: 500,
  name: "Mathias Axell",
  competitor_number: "118",
  division: "Production",
  squad: "4",
};

const STAGE: LiveGridStage = {
  stage_id: 10,
  stage_num: 4,
  name: "Steel Alley",
  max_points: 60,
};

function cell(over: Partial<LiveGridCell> = {}): LiveGridCell {
  return {
    hf: 5.42,
    time: 16.42,
    points: 48,
    a: 8,
    c: 2,
    d: 1,
    m: 0,
    ns: 1,
    p: 0,
    status: "scored",
    created: "2026-08-23T09:00:00Z",
    ...over,
  };
}

function renderSheet(over: Partial<LiveGridCell> = {}) {
  return render(
    <LiveGridSheet
      open
      cell={cell(over)}
      shooter={SHOOTER}
      stage={STAGE}
      onClose={vi.fn()}
    />,
  );
}

describe("LiveGridSheet", () => {
  it("names the shooter and the stage", () => {
    renderSheet();
    expect(screen.getByText("Mathias Axell")).toBeInTheDocument();
    expect(screen.getByText(/Steel Alley/)).toBeInTheDocument();
  });

  it("shows points against the stage max", () => {
    renderSheet();
    expect(screen.getByText("48")).toBeInTheDocument();
    expect(screen.getByText("/60")).toBeInTheDocument();
  });

  it("lists no-shoots as their own row", () => {
    renderSheet();
    expect(screen.getByText("no-shoot")).toBeInTheDocument();
  });

  it("omits zero-count zones", () => {
    renderSheet({ p: 0 });
    expect(screen.queryByText("procedural")).not.toBeInTheDocument();
  });

  it("labels the points-dropped figure as minor scoring", () => {
    renderSheet();
    expect(screen.getByText(/points dropped \(minor\)/i)).toBeInTheDocument();
  });

  it("celebrates a clean stage instead of showing a drop", () => {
    renderSheet({ a: 12, c: 0, d: 0, m: 0, ns: 0, p: 0, points: 60 });
    expect(screen.getByText("Clean stage")).toBeInTheDocument();
    expect(screen.queryByText(/points dropped/i)).not.toBeInTheDocument();
  });

  it("is a modal dialog", () => {
    renderSheet();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("renders nothing when closed", () => {
    render(
      <LiveGridSheet
        open={false}
        cell={cell()}
        shooter={SHOOTER}
        stage={STAGE}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reports a DQ instead of a scorecard", () => {
    renderSheet({ status: "dq" });
    expect(screen.getByText(/Disqualified/)).toBeInTheDocument();
  });

  it("states the figures carry no field context", () => {
    renderSheet();
    expect(screen.getByText(/no stage winner/i)).toBeInTheDocument();
  });
});
