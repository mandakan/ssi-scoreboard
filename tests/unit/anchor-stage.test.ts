import { describe, it, expect } from "vitest";
import { computeAnchorStage, type StagePctRecord } from "@/lib/anchor-stage";

function makeRecord(overrides: Partial<StagePctRecord> = {}): StagePctRecord {
  return {
    stagePct: 80,
    stageName: "Stage 1",
    stageNumber: 1,
    matchName: "Test Match",
    ct: "22",
    matchId: "100",
    date: "2025-01-01",
    division: "Production Optics",
    ...overrides,
  };
}

function makeRecords(count: number, basePct = 80): StagePctRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord({ stageNumber: i + 1, stageName: `Stage ${i + 1}`, stagePct: basePct }),
  );
}

describe("computeAnchorStage", () => {
  it("returns null when fewer than 10 stages", () => {
    expect(computeAnchorStage(makeRecords(9))).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(computeAnchorStage([])).toBeNull();
  });

  it("returns null for exactly 9 stages (boundary)", () => {
    expect(computeAnchorStage(makeRecords(9))).toBeNull();
  });

  it("returns a result for exactly 10 stages", () => {
    const result = computeAnchorStage(makeRecords(10));
    expect(result).not.toBeNull();
  });

  it("picks the stage with highest stagePct", () => {
    const stages = makeRecords(10, 70);
    stages[4] = makeRecord({ stageNumber: 5, stageName: "Best", stagePct: 98.5 });
    const result = computeAnchorStage(stages);
    expect(result?.stageName).toBe("Best");
    expect(result?.stagePct).toBe(98.5);
  });

  it("returns correct metadata on the best stage", () => {
    const stages = makeRecords(10, 70);
    stages[2] = makeRecord({
      stageNumber: 3,
      stageName: "Stage 3",
      stagePct: 97.0,
      matchName: "SPSK Open 2025",
      ct: "22",
      matchId: "12345",
      date: "2025-06-01",
      division: "Standard",
    });
    const result = computeAnchorStage(stages);
    expect(result).toEqual({
      stageName: "Stage 3",
      stageNumber: 3,
      matchName: "SPSK Open 2025",
      ct: "22",
      matchId: "12345",
      date: "2025-06-01",
      division: "Standard",
      stagePct: 97.0,
    });
  });

  it("tiebreaks by most recent date when stagePct is equal", () => {
    const stages = makeRecords(10, 80);
    stages[0] = makeRecord({ stagePct: 95, date: "2024-01-01", stageName: "Old" });
    stages[1] = makeRecord({ stagePct: 95, date: "2025-06-15", stageName: "Recent" });
    const result = computeAnchorStage(stages);
    expect(result?.stageName).toBe("Recent");
  });

  it("tiebreaks: null date loses to any real date", () => {
    const stages = makeRecords(10, 80);
    stages[0] = makeRecord({ stagePct: 95, date: null, stageName: "NoDate" });
    stages[1] = makeRecord({ stagePct: 95, date: "2025-01-01", stageName: "Dated" });
    const result = computeAnchorStage(stages);
    expect(result?.stageName).toBe("Dated");
  });

  it("works when all stages are from different matches", () => {
    const stages = Array.from({ length: 10 }, (_, i) =>
      makeRecord({
        stageNumber: 1,
        matchId: String(i + 1),
        matchName: `Match ${i + 1}`,
        stagePct: 50 + i * 5,
      }),
    );
    const result = computeAnchorStage(stages);
    expect(result?.matchId).toBe("10");
    expect(result?.stagePct).toBe(95);
  });

  it("handles 100% stages (stage winner)", () => {
    const stages = makeRecords(10, 80);
    stages[5] = makeRecord({ stagePct: 100, stageName: "Perfect" });
    const result = computeAnchorStage(stages);
    expect(result?.stagePct).toBe(100);
    expect(result?.stageName).toBe("Perfect");
  });

  it("processes large history without error", () => {
    const stages = makeRecords(200, 75);
    stages[150] = makeRecord({ stagePct: 99.9, stageName: "Peak" });
    const result = computeAnchorStage(stages);
    expect(result?.stageName).toBe("Peak");
  });
});
