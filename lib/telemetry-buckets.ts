// Client-safe, dependency-free bucketing helpers shared by server telemetry
// (lib/usage-telemetry.ts) and browser telemetry call sites. Keep zod and
// server imports out of this file -- client components import it.

/** Bucket competitor count for stage-export usage events. Mirrors the
 *  scale used by mcp-telemetry's bucketCompetitors so dashboards can join
 *  on the same labels. */
export function bucketStageExportCompetitors(n: number): "1" | "2-4" | "5-12" {
  if (n <= 1) return "1";
  if (n <= 4) return "2-4";
  return "5-12";
}
