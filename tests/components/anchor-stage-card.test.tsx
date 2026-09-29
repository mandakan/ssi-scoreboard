import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnchorStageCard } from "@/components/anchor-stage-card";
import type { AnchorStage } from "@/lib/types";

const anchorStage: AnchorStage = {
  stageName: "Stage Three",
  stageNumber: 3,
  matchName: "Test Match",
  ct: "22",
  matchId: "1",
  date: "2026-05-01T08:00:00Z",
  division: "Production",
  stagePct: 91.2,
};

describe("AnchorStageCard", () => {
  it("links to the stage anchor on the analysis tab", () => {
    render(<AnchorStageCard anchorStage={anchorStage} />);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("/match/22/1"));
    expect(link?.getAttribute("href")).toBe("/match/22/1/analysis#stage-3");
  });
});
