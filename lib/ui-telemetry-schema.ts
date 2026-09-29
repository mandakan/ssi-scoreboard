// Client-safe: no server imports. Shared by the browser helper
// (lib/ui-telemetry.ts, type-only import) and POST /api/telemetry/ui.
//
// Every UI event carries `ct` plus enum values -- no match id, shooter id,
// competitor id, or free text (docs/telemetry.md "Privacy commitments").
// `.strict()` makes an unexpected field a rejection, not a silent strip, so
// a future call site cannot smuggle an identifier into the log.

import { z } from "zod";

export const UI_TELEMETRY_MAX_BYTES = 1024;

export const CHART_IDS = [
  "hf-by-stage",
  "hf-pct",
  "division-position",
  "speed-accuracy",
  "stage-balance",
] as const;

/** Bucket competitor count for stage-export usage events. Mirrors the
 *  scale used by mcp-telemetry's bucketCompetitors so dashboards can join
 *  on the same labels. */
export function bucketStageExportCompetitors(n: number): "1" | "2-4" | "5-12" {
  if (n <= 1) return "1";
  if (n <= 4) return "2-4";
  return "5-12";
}

const ct = z.number().int().positive();

export const uiTelemetryEventSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("tab-view"),
    ct,
    tab: z.enum(["grid", "info", "analysis"]),
  }).strict(),
  z.object({
    op: z.literal("analysis-section-open"),
    ct,
    section: z.enum(["charts", "deep-dive", "simulator"]),
  }).strict(),
  z.object({
    op: z.literal("chart-switch"),
    ct,
    chart: z.enum(CHART_IDS),
  }).strict(),
  z.object({
    op: z.literal("stage-export"),
    ct,
    surface: z.literal("ui"),
    nCompetitorsBucket: z.enum(["1", "2-4", "5-12"]),
  }).strict(),
]);

export type UiTelemetryEvent = z.infer<typeof uiTelemetryEventSchema>;
