import type { StageComparison } from "@/lib/types";

/**
 * Reference for the HF% line chart.
 * - "stage_winner": relative to the full-field stage winner (= overall_percent)
 * - number: relative to a specific competitor's HF on that stage (by competitor_id)
 */
export type RefMode = "stage_winner" | number;

/**
 * Compute HF% for a competitor on a stage relative to a reference.
 *
 *   HF% = (competitor_hf / reference_hf) × 100
 *
 * For "stage_winner" mode, this returns overall_percent which is already computed
 * relative to the full-field stage winner.
 *
 * Returns null when:
 *   - Competitor has no scorecard or is DNF on this stage
 *   - Competitor's effective HF is null
 *   - Reference HF is null or zero (prevents division by zero)
 *   - Reference competitor is DNF on this stage
 */
export function computeHfPct(
  stage: StageComparison,
  compId: number,
  refMode: RefMode
): number | null {
  const sc = stage.competitors[compId];
  if (!sc || sc.dnf) return null;

  if (refMode === "stage_winner") {
    // overall_percent = (competitor_hf / overall_leader_hf) × 100
    return sc.overall_percent;
  }

  // Specific competitor reference
  const refSc = stage.competitors[refMode];
  // refSc.hit_factor is 0 for DQ/zeroed — !0 === true, guards division-by-zero
  if (!refSc || refSc.dnf || !refSc.hit_factor) return null;
  const hf = sc.hit_factor;
  if (hf == null) return null;
  return (hf / refSc.hit_factor) * 100;
}
