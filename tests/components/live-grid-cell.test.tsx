import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveGridCellView } from "@/components/live-grid-cell";
import type { LiveGridCell } from "@/lib/types";

function cell(over: Partial<LiveGridCell> = {}): LiveGridCell {
  return {
    hf: 5.42,
    time: 16.42,
    points: 89,
    a: 16,
    c: 0,
    d: 0,
    m: 0,
    ns: 0,
    p: 0,
    status: "scored",
    created: "2026-08-23T09:00:00Z",
    ...over,
  };
}

describe("LiveGridCellView", () => {
  it("shows hit factor and time for a scored run", () => {
    render(<LiveGridCellView cell={cell()} />);
    expect(screen.getByText("5.42")).toBeInTheDocument();
    expect(screen.getByText("16.42")).toBeInTheDocument();
  });

  it("marks an all-alpha run with an accessible clean label", () => {
    render(<LiveGridCellView cell={cell()} />);
    expect(screen.getByLabelText("All alpha, clean stage")).toBeInTheDocument();
  });

  it("drops the clean marker as soon as a single charlie appears", () => {
    render(<LiveGridCellView cell={cell({ c: 1 })} />);
    expect(
      screen.queryByLabelText("All alpha, clean stage"),
    ).not.toBeInTheDocument();
  });

  it("drops the clean marker for a penalty even with all alphas", () => {
    render(<LiveGridCellView cell={cell({ ns: 1 })} />);
    expect(
      screen.queryByLabelText("All alpha, clean stage"),
    ).not.toBeInTheDocument();
  });

  it("renders DQ instead of a score", () => {
    render(<LiveGridCellView cell={cell({ status: "dq" })} />);
    expect(screen.getByText("DQ")).toBeInTheDocument();
    expect(screen.queryByText("5.42")).not.toBeInTheDocument();
  });

  it("renders ZERO with the time still visible", () => {
    render(<LiveGridCellView cell={cell({ status: "zeroed" })} />);
    expect(screen.getByText("ZERO")).toBeInTheDocument();
    expect(screen.getByText("16.42")).toBeInTheDocument();
  });

  it("renders a pending placeholder when the stage is not yet shot", () => {
    render(
      <LiveGridCellView cell={cell({ status: "pending", hf: null, time: null })} />,
    );
    expect(screen.getByLabelText("Not shot yet")).toBeInTheDocument();
  });

  it("treats not_fired the same as pending", () => {
    render(<LiveGridCellView cell={cell({ status: "not_fired" })} />);
    expect(screen.getByLabelText("Not shot yet")).toBeInTheDocument();
  });

  it("shows the penalty count next to its pip", () => {
    render(<LiveGridCellView cell={cell({ c: 2, m: 1, ns: 1 })} />);
    expect(screen.getByText(/M1/)).toBeInTheDocument();
    expect(screen.getByText(/N1/)).toBeInTheDocument();
  });

  it("carries the full breakdown in an accessible label so nothing rests on colour", () => {
    render(<LiveGridCellView cell={cell({ a: 12, c: 2, d: 1, m: 1 })} />);
    const label = screen.getByLabelText(/12A/);
    expect(label).toHaveAccessibleName(expect.stringContaining("2C"));
    expect(label).toHaveAccessibleName(expect.stringContaining("1D"));
  });
});
