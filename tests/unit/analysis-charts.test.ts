import { describe, expect, it } from "vitest";
import { ANALYSIS_CHARTS, availableCharts, chartForHash, resolveChart } from "@/lib/analysis-charts";
import { CHART_IDS } from "@/lib/ui-telemetry-schema";
import type { CompareResponse } from "@/lib/types";

const withDist = { stages: [{ divisionDistributions: { Production: {} } }] } as unknown as CompareResponse;
const noDist = { stages: [{ divisionDistributions: {} }, {}] } as unknown as CompareResponse;

describe("analysis charts", () => {
  it("covers exactly the telemetry chart ids, in order", () => {
    expect(ANALYSIS_CHARTS.map((c) => c.id)).toEqual([...CHART_IDS]);
  });
  it("offers division position only with distribution data", () => {
    expect(availableCharts(withDist)).toContain("division-position");
    expect(availableCharts(noDist)).not.toContain("division-position");
    expect(availableCharts(noDist)).toHaveLength(4);
  });
  it("resolves a stored choice when available", () => {
    expect(resolveChart("stage-balance", availableCharts(noDist))).toBe("stage-balance");
  });
  it("falls back to the first chart for missing, unknown or unavailable ids", () => {
    const av = availableCharts(noDist);
    expect(resolveChart(null, av)).toBe("hf-by-stage");
    expect(resolveChart("pie", av)).toBe("hf-by-stage");
    expect(resolveChart("division-position", av)).toBe("hf-by-stage");
  });

  describe("chartForHash", () => {
    const av = availableCharts(noDist);
    it("maps a known anchor to its chart when available", () => {
      expect(chartForHash("#chart-speed-accuracy", av)).toBe("speed-accuracy");
    });
    it("returns null when the mapped chart is unavailable", () => {
      expect(chartForHash("#chart-speed-accuracy", ["hf-by-stage"])).toBeNull();
    });
    it("returns null for unknown or empty hashes", () => {
      expect(chartForHash("#nope", av)).toBeNull();
      expect(chartForHash("", av)).toBeNull();
      expect(chartForHash("#", av)).toBeNull();
    });
  });
});
