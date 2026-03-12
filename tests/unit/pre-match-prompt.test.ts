import { describe, it, expect } from "vitest";
import { computeSquadContext, buildPreMatchBriefPrompt } from "@/lib/pre-match-prompt";
import type { StageInfo } from "@/lib/types";

function makeStage(stage_number: number): StageInfo {
  return {
    id: stage_number,
    name: `Stage ${stage_number}`,
    stage_number,
    max_points: 50,
    min_rounds: 12,
    paper_targets: 5,
    steel_targets: 2,
    ssi_url: null,
    course_display: "Medium",
    procedure: null,
    firearm_condition: null,
  };
}

const stages6 = [1, 2, 3, 4, 5, 6].map(makeStage);

describe("computeSquadContext", () => {
  it("position 1 (idx 0) starts stage 1 and wraps to stage 6 in a 5-member squad", () => {
    const ctx = computeSquadContext(0, 5, stages6);
    expect(ctx.position).toBe(1);
    expect(ctx.squadSize).toBe(5);
    expect(ctx.startingStages).toEqual([1, 6]);
  });

  it("position 2 starts stage 2 only when squad size equals stage count", () => {
    const ctx = computeSquadContext(1, 6, stages6);
    expect(ctx.position).toBe(2);
    expect(ctx.startingStages).toEqual([2]);
  });

  it("position 5 starts stage 5 only in a 5-member squad of 6 stages", () => {
    const ctx = computeSquadContext(4, 5, stages6);
    expect(ctx.position).toBe(5);
    expect(ctx.startingStages).toEqual([5]);
  });

  it("position 3 starts stages 3 and 6 when squad has 3 members and 6 stages", () => {
    const ctx = computeSquadContext(2, 3, stages6);
    expect(ctx.startingStages).toEqual([3, 6]);
  });

  it("every stage is covered exactly once across all positions in an evenly-sized squad", () => {
    const squadSize = 6;
    const allStarting = Array.from({ length: squadSize }, (_, i) =>
      computeSquadContext(i, squadSize, stages6).startingStages,
    ).flat();
    expect(allStarting.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("every stage is covered exactly once across a 5-member squad of 6 stages", () => {
    const squadSize = 5;
    const allStarting = Array.from({ length: squadSize }, (_, i) =>
      computeSquadContext(i, squadSize, stages6).startingStages,
    ).flat();
    expect(allStarting.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns empty startingStages when the position never starts (more members than stages)", () => {
    const stages2 = [1, 2].map(makeStage);
    const ctx = computeSquadContext(4, 8, stages2); // position 5 in an 8-person squad, only 2 stages
    expect(ctx.startingStages).toEqual([]);
  });
});

describe("buildPreMatchBriefPrompt — squad context", () => {
  const baseInput = {
    matchName: "Test Open",
    matchLevel: "Level 3",
    stages: stages6,
    shooterName: "Alice",
    dashboard: null,
    squadContext: null,
  };

  it("includes squad position and starting stages in the prompt when context is provided", () => {
    const prompt = buildPreMatchBriefPrompt({
      ...baseInput,
      squadContext: { position: 1, squadSize: 5, startingStages: [1, 6] },
    });
    expect(prompt).toContain("SQUAD POSITION: 1 of 5");
    expect(prompt).toContain("STAGES SHOOTER STARTS: 1, 6");
  });

  it("omits squad section when squadContext is null", () => {
    const prompt = buildPreMatchBriefPrompt(baseInput);
    expect(prompt).not.toContain("SQUAD POSITION");
    expect(prompt).not.toContain("STAGES SHOOTER STARTS");
  });

  it("omits starting stages line when startingStages is empty", () => {
    const prompt = buildPreMatchBriefPrompt({
      ...baseInput,
      squadContext: { position: 5, squadSize: 8, startingStages: [] },
    });
    expect(prompt).toContain("SQUAD POSITION: 5 of 8");
    expect(prompt).not.toContain("STAGES SHOOTER STARTS");
  });
});
