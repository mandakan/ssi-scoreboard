import { describe, expect, it } from "vitest";
import {
  bucketStageExportCompetitors,
  CHART_IDS,
  uiTelemetryEventSchema,
} from "@/lib/ui-telemetry-schema";

const ok = (v: unknown) => uiTelemetryEventSchema.safeParse(v).success;

describe("uiTelemetryEventSchema", () => {
  it("accepts every op", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "grid" })).toBe(true);
    expect(ok({ op: "analysis-section-open", ct: 22, section: "deep-dive" })).toBe(true);
    for (const chart of CHART_IDS) {
      expect(ok({ op: "chart-switch", ct: 22, chart })).toBe(true);
    }
    expect(ok({ op: "stage-export", ct: 22, surface: "ui", nCompetitorsBucket: "2-4" })).toBe(true);
  });

  it("rejects unknown ops", () => {
    expect(ok({ op: "match-view", ct: 22 })).toBe(false);
    expect(ok({ op: "anything", ct: 22 })).toBe(false);
  });

  it("rejects unknown enum values", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "settings" })).toBe(false);
    expect(ok({ op: "chart-switch", ct: 22, chart: "pie" })).toBe(false);
    expect(ok({ op: "stage-export", ct: 22, surface: "mcp", nCompetitorsBucket: "1" })).toBe(false);
  });

  it("rejects smuggled identifying fields instead of stripping them", () => {
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", shooterId: 5 })).toBe(false);
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", matchId: "123" })).toBe(false);
    expect(ok({ op: "tab-view", ct: 22, tab: "grid", competitorIds: [1] })).toBe(false);
  });

  it("requires a positive integer ct", () => {
    expect(ok({ op: "tab-view", ct: 0, tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", ct: 2.5, tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", ct: "22", tab: "grid" })).toBe(false);
    expect(ok({ op: "tab-view", tab: "grid" })).toBe(false);
  });
});

describe("bucketStageExportCompetitors", () => {
  it("buckets", () => {
    expect(bucketStageExportCompetitors(1)).toBe("1");
    expect(bucketStageExportCompetitors(0)).toBe("1");
    expect(bucketStageExportCompetitors(4)).toBe("2-4");
    expect(bucketStageExportCompetitors(12)).toBe("5-12");
  });
});
