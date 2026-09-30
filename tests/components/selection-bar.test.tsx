import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { MatchResponse } from "@/lib/types";

vi.mock("@/components/competitor-picker", () => ({
  CompetitorPicker: () => <button type="button">Add competitor</button>,
}));
vi.mock("@/components/squad-picker", () => ({
  SquadPicker: () => <button type="button">Squad</button>,
}));
vi.mock("@/components/benchmark-picker", () => ({
  BenchmarkPicker: () => <button type="button">Benchmark</button>,
}));

import { SelectionBar } from "@/components/analysis/selection-bar";

const match = {
  name: "M",
  competitors: [
    { id: 1, shooterId: null, name: "Anna Lind", competitor_number: "1", club: null, division: null },
    { id: 2, shooterId: null, name: "Erik Svensson", competitor_number: "2", club: null, division: null },
  ],
  squads: [],
} as unknown as MatchResponse;

function setup(over: Partial<React.ComponentProps<typeof SelectionBar>> = {}) {
  const props = {
    match,
    selectedIds: [1, 2],
    gridRows: [2],
    identityShooterId: null,
    trackedIds: new Set<number>(),
    fieldFingerprintPoints: [],
    benchmarkDisabled: false,
    trackedInMatch: null,
    onSelectionChange: vi.fn(),
    onReplaceSelection: vi.fn(),
    onSetMyIdentity: vi.fn(),
    onToggleTracked: vi.fn(),
    onManage: vi.fn(),
    pendingUndo: null,
    onUndo: vi.fn(),
    ...over,
  };
  render(<SelectionBar {...props} />);
  return props;
}

describe("SelectionBar", () => {
  it("shows a summary button that opens the picker dialog", () => {
    setup();
    const btn = screen.getByRole("button", { name: /Comparing: Anna L., Erik S./ });
    expect(btn).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(btn);
    const dialog = screen.getByRole("dialog", { name: "Who to compare" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add competitor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear/ })).toBeInTheDocument();
  });

  it("resets to grid shooters", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Comparing:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to grid shooters" }));
    expect(props.onReplaceSelection).toHaveBeenCalledWith([2], "Reset to grid shooters");
  });

  it("prompts to choose when nothing is selected", () => {
    setup({ selectedIds: [] });
    fireEvent.click(screen.getByRole("button", { name: /Choose shooters to compare/ }));
    expect(screen.getByRole("dialog", { name: "Who to compare" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add competitor" })).toBeInTheDocument();
  });

  it("hides the reset button without grid rows", () => {
    setup({ gridRows: [] });
    fireEvent.click(screen.getByRole("button", { name: /Comparing:/ }));
    expect(screen.queryByRole("button", { name: "Reset to grid shooters" })).toBeNull();
  });

  it("returns focus to the summary button when the sheet closes and exposes aria-expanded", async () => {
    setup();
    const btn = screen.getByRole("button", { name: /Comparing:/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /Comparing:/, hidden: true })).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Who to compare" }), { key: "Escape" });
    const after = screen.getByRole("button", { name: /Comparing:/ });
    expect(after).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(document.activeElement).toBe(after));
  });

  it("shows the pending undo inside the open sheet and calls onUndo", () => {
    const onUndo = vi.fn();
    setup({ pendingUndo: { message: "Cleared 2 selected" }, onUndo });
    fireEvent.click(screen.getByRole("button", { name: /Comparing:/ }));
    const dialog = screen.getByRole("dialog", { name: "Who to compare" });
    const undo = within(dialog).getByRole("button", { name: "Undo last selection change" });
    expect(within(dialog).getByText("Cleared 2 selected")).toBeInTheDocument();
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
