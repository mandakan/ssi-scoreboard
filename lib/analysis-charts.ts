// Chart catalogue for the Analysis tab's Charts card. Ids double as the
// telemetry enum (lib/ui-telemetry-schema.ts CHART_IDS), so the order and
// spelling must match -- a unit test pins it.

import type { CHART_IDS } from "@/lib/ui-telemetry-schema";
import type { CompareResponse } from "@/lib/types";

export type AnalysisChartId = (typeof CHART_IDS)[number];

export const CHART_STORAGE_KEY = "ssi-analysis-chart";

export const ANALYSIS_CHARTS: { id: AnalysisChartId; label: string; title: string }[] = [
  { id: "hf-by-stage", label: "HF by stage", title: "Hit factor by stage" },
  { id: "hf-pct", label: "HF %", title: "HF% vs stage winner" },
  { id: "division-position", label: "Division", title: "Division position" },
  { id: "speed-accuracy", label: "Speed/accuracy", title: "Speed vs. accuracy" },
  { id: "stage-balance", label: "Balance", title: "Stage balance" },
];

export function availableCharts(data: CompareResponse): AnalysisChartId[] {
  const hasDist = data.stages.some(
    (s) => Object.keys(s.divisionDistributions ?? {}).length > 0,
  );
  return ANALYSIS_CHARTS.map((c) => c.id).filter(
    (id) => id !== "division-position" || hasDist,
  );
}

export function resolveChart(
  stored: string | null,
  available: AnalysisChartId[],
): AnalysisChartId {
  return available.find((id) => id === stored) ?? available[0];
}
