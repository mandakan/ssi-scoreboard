# Courtside Grid -- the live view

One row per shooter, one column per stage, full-screen on a phone. The default
surface for `effectiveMode === "live"`. The comparison table and coaching
analysis stay one tap away behind "Full analysis".

Design doc: `docs/superpowers/specs/2026-08-23-live-grid-design.md`.

## The contract (read this before changing anything)

**Every field the grid renders is derivable from a single shooter's own
scorecard, plus the stage list.**

No `group_leader_hf`. No `overall_leader_hf`. No `field_median_hf`. No
`divisionDistributions`. No rankings, archetypes, or fingerprints.

This is not minimalism for its own sake. Today `/api/live-grid` projects the
already-cached whole-field snapshot, so the constraint costs nothing. Its
purpose is Phase 2: SSI exposes a per-competitor scorecard path, and the
moment the grid needs one competitor's data to render another's cell, that
swap stops being a server-only change.

If you are about to add "you were 87% of the stage winner" to the detail
sheet -- that is the field dependency. Put it in the comparison table instead.

## Files

| File | Responsibility |
|---|---|
| `lib/live-grid.ts` | `buildLiveGridCells()`, `computeLiveEdgeStageId()` -- pure projection |
| `lib/live-grid-rows.ts` | `resolveGridRows()` -- squad vs tracked row sources |
| `app/api/live-grid/route.ts` | Cache reads, then projection. Imports nothing from `compare/logic` |
| `components/live-grid.tsx` | Full-screen shell, rail, sticky-column table |
| `components/live-grid-cell.tsx` | The cell -- quiet by default |
| `components/live-grid-sheet.tsx` | Tap-through scorecard detail |

## Rows

`resolveGridRows()` maps a `GridRowSource` to competitor IDs:

- `"squad"` -- everyone in the squad the user's identity belongs to
- `"tracked"` -- the user's identity plus starred shooters present in this match

Both resolve from the already-cached `GetMatch` response
(`squads[].competitorIds`, `competitors[].shooterId`), so switching source
costs nothing upstream. Falls back to the existing competitor selection when
the source resolves to nothing. The user's own row is sorted first. Capped at
`MAX_LIVE_GRID_ROWS` (20), separate from `MAX_COMPETITORS` (12) because a
squad can exceed 14.

## The cell

Hit factor, time, then the zone story -- but only when there is one.

- **Points dropped** -- A/C/D proportional bar reusing `BAR_SEGMENTS` from
  `hit-zone-bar.tsx`, plus M/NS/P shape pips with counts.
- **Clean run** -- a green circle and `ALL A`. The circle is the one shape
  neither the bar (rectangle) nor the pips (square, triangle, diamond) use,
  so it separates under greyscale and CVD without relying on colour. Exact
  counts also ride in the cell's `aria-label`.
- **Not scored** -- `DQ`, `ZERO`, or an em dash.

An all-alpha run is the best thing that can appear on the page, so it gets a
positive mark. Drawing nothing would make "clean" and "no data" identical.

`ns` maps from SSI's `penalty` field (`lib/scorecard-data.ts`). `c` already
folds B-zone into C.

### Known gap: Major scoring

The detail sheet's points-dropped arithmetic assumes **Minor** (A5/C3/D1) and
is labelled `(minor)` for that reason. Major is A5/C4/D2. See
`TODO(major-scoring)` in `components/live-grid-sheet.tsx`.

## Refresh

`useLiveGridQuery` reuses the same 30s cadence the live comparison already
runs at. **Do not add a second poll clock.** The server's freshness window
(`computeMatchFreshness`) is what bounds upstream traffic; a second cadence on
the same match raises refresh frequency, which is the opposite of why this
view exists.

While the grid is showing, `compareEnabled` is false in
`match-page-client.tsx`. If compare fires alongside the grid it pulls the
whole-field snapshot anyway and the saving is gone. There is an e2e assertion
guarding this (`tests/e2e/live-grid.spec.ts`).

## Phase 2 -- per-competitor fetching (not yet built)

SSI exposes, and we have never used:

```
RootQuery.competitor_scorecards(content_type, id, updated_after) -> [ScoreCardInterface!]!
RootQuery.competitor_scorecards_count(content_type, id) -> Int!
IpscCompetitorNode.scorecards(updated_after) / .scorecards_count / .latest_scorecard_update
```

Behind `LIVE_GRID_PER_COMPETITOR=on`, watermarked by
`latest_scorecard_update` like the existing stage sidecar, cached per
competitor (`sc:comp:{ct}:{compId}`) so overlapping squad-watchers share keys.

**Gated on `scripts/spike-competitor-scorecards.ts`,** which has not run --
SSI's API key is enabled on weekdays only. Three questions, in priority order:

1. Does GraphQL **alias-batching** of N competitors in one request work? This
   is the load question. 14 competitor requests is *worse* than 12 stage
   requests on request count, and request count is what caused the
   2026-08-15 outage. Payload shrinks either way; request count does not.
2. Does the root `competitor_scorecards` resolver work at all? The sibling
   root `competitor(content_type, id)` returns 404 in practice
   (`lib/graphql.ts`).
3. Does it respect `is_live_scores_accessible`?

**Phase 1 delivers no upstream reduction.** It delivers the view, the
contract, and courtside testing. Measure Phase 2 the way the 2026-08-20 run
was measured (234 client requests -> 25 upstream calls) rather than asserting
the improvement.
