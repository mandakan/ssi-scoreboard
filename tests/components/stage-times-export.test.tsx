import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CompareResponse, MatchResponse } from "@/lib/types";

const trackUi = vi.fn();
vi.mock("@/lib/ui-telemetry", () => ({ trackUi: (ev: unknown) => trackUi(ev) }));
vi.mock("@/lib/stage-times-export", () => ({
  buildStageTimesExport: () => ({ match: { ct: "22", id: "1", name: "M" } }),
  buildStageTimesCsv: () => "a,b",
  stageTimesFilenameStem: () => "m",
}));

import { StageTimesExport } from "@/components/stage-times-export";

const match = { name: "M", competitors: [], squads: [] } as unknown as MatchResponse;
const compareData = {} as CompareResponse;

describe("StageTimesExport telemetry", () => {
  beforeEach(() => {
    trackUi.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it.each([["Download JSON"], ["Download CSV"]])("%s emits stage-export ui", (label) => {
    render(
      <StageTimesExport ct="22" id="1" match={match} compareData={compareData} selectedIds={[1, 2, 3]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(trackUi).toHaveBeenCalledWith({
      op: "stage-export", ct: 22, surface: "ui", nCompetitorsBucket: "2-4",
    });
  });
});
