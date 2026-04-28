// Pure merge logic for the incremental scorecard delta path. No I/O —
// dependency-injected from `refreshCachedMatchQuery` so it is fully unit-tested
// without the cache or GraphQL layers.
//
// The merge maps a flat delta payload (each entry carrying its `stage.id` and
// `competitor.id`) onto the cached per-stage `RawScorecardsData` shape. Match
// key is the composite `(stageId, competitorId)` — a competitor has at most
// one scorecard per stage in IPSC scoring (reshoots replace, not append).
//
// On any structural problem (missing stage in cached snapshot, malformed
// delta entry) the merge fails with `ok: false` so callers can fall back to a
// full refetch instead of producing an inconsistent snapshot.

import type { RawScorecardsData, RawScCard, RawStage } from "@/lib/scorecard-data";
import type { ScorecardDeltaEntry } from "@/lib/graphql";

export interface MergeResult {
  ok: true;
  data: RawScorecardsData;
  /** Number of scorecards that replaced an existing entry. */
  updatedCount: number;
  /** Number of scorecards added that did not previously exist. */
  addedCount: number;
}

export interface MergeFailure {
  ok: false;
  /** Stable short reason — used in telemetry to spot recurring patterns. */
  reason:
    | "stage-missing"
    | "competitor-missing"
    | "stages-missing"
    | "no-event";
}

// CRITICAL: every field on RawScCard / ScorecardDeltaEntry must be copied here.
// A missing field would silently null-out that field in the cached snapshot on
// every delta merge, corrupting downstream rendering. See CLAUDE.md
// → "Delta-merge contract" for the full update checklist.
function deltaToCacheCard(d: ScorecardDeltaEntry): RawScCard {
  return {
    created: d.created ?? null,
    points: d.points ?? null,
    hitfactor: d.hitfactor ?? null,
    time: d.time ?? null,
    disqualified: d.disqualified ?? null,
    zeroed: d.zeroed ?? null,
    stage_not_fired: d.stage_not_fired ?? null,
    incomplete: d.incomplete ?? null,
    ascore: d.ascore ?? null,
    bscore: d.bscore ?? null,
    cscore: d.cscore ?? null,
    dscore: d.dscore ?? null,
    miss: d.miss ?? null,
    penalty: d.penalty ?? null,
    procedural: d.procedural ?? null,
    competitor: d.competitor
      ? {
          id: d.competitor.id,
          first_name: d.competitor.first_name,
          last_name: d.competitor.last_name,
          number: d.competitor.number,
          club: d.competitor.club ?? null,
          get_division_display: d.competitor.get_division_display ?? null,
          handgun_div: d.competitor.handgun_div ?? null,
          get_handgun_div_display: d.competitor.get_handgun_div_display ?? null,
        }
      : null,
  };
}

/**
 * Merge a flat delta payload into the cached per-stage scorecard snapshot.
 *
 * Returns a new `RawScorecardsData` (the cached input is not mutated) plus
 * counts. Caller should write the new snapshot back to the cache and
 * (separately) re-emit telemetry.
 *
 * Failure modes — caller falls back to a full refetch:
 *   - cached entry has no event / no stages list (cache shape drift)
 *   - delta entry references a stage that doesn't exist in the cached entry
 *     (a new stage was added upstream — full refetch will pick it up)
 *   - delta entry has no competitor (malformed payload)
 */
export function mergeScorecardDelta(
  cached: RawScorecardsData,
  delta: ScorecardDeltaEntry[],
): MergeResult | MergeFailure {
  if (!cached.event) return { ok: false, reason: "no-event" };
  if (!cached.event.stages) return { ok: false, reason: "stages-missing" };

  // Build a stage-id → cloned-stage map for O(1) lookups during merge.
  // Clone scorecards arrays so we can mutate without touching the input.
  const stagesById = new Map<string, RawStage>();
  for (const s of cached.event.stages) {
    stagesById.set(s.id, {
      ...s,
      scorecards: s.scorecards ? [...s.scorecards] : [],
    });
  }

  let updatedCount = 0;
  let addedCount = 0;

  for (const d of delta) {
    const stageId = d.stage?.id;
    if (!stageId) return { ok: false, reason: "stage-missing" };

    const stage = stagesById.get(stageId);
    if (!stage) return { ok: false, reason: "stage-missing" };

    if (!d.competitor?.id) return { ok: false, reason: "competitor-missing" };
    const competitorId = d.competitor.id;

    const cards = stage.scorecards as RawScCard[];
    const idx = cards.findIndex((c) => c.competitor?.id === competitorId);
    const merged = deltaToCacheCard(d);

    if (idx >= 0) {
      cards[idx] = merged;
      updatedCount++;
    } else {
      cards.push(merged);
      addedCount++;
    }
  }

  return {
    ok: true,
    data: {
      event: {
        ...cached.event,
        stages: Array.from(stagesById.values()),
      },
    },
    updatedCount,
    addedCount,
  };
}
