# Courtside Grid -- minimal live view

Design doc. Status: approved 2026-08-23.

Interactive prototype (real component, switchable cell variants, tap-through
detail sheet): <https://claude.ai/code/artifact/b0b7f947-9617-4255-b542-2646110638e4>

**The implementation plan that follows this spec covers Phase 1 only.** Phase 2
is specified here for context but is gated on a spike that cannot run until
SSI's API key is enabled on a weekday.

## Problem

The live view is the coaching view with the expensive analytics switched off.
It renders `comparison-table.tsx` (2373 lines) inside a scrolling page, laid
out stages-as-rows and competitors-as-columns, capped at
`MAX_COMPETITORS = 12`.

The stated pain is upstream load on SSI. Per 60s cycle a live match costs one
`MatchSyncProbe` plus one `STAGE_SCORECARDS_QUERY` per changed stage, and each
of those returns the **full field** for that stage. A 12-stage,
300-competitor match under active shooting is roughly 12 requests and ~3600
scorecard objects a minute, for as long as anyone has the page open.
Refreshes are viewer-driven and single-flighted per match, so one viewer costs
the same as two hundred.

## Goal

A full-screen, one-row-per-shooter, one-column-per-stage grid that is the
default live experience, and whose data contract depends only on each
shooter's own scorecard -- so the server can later fetch just those shooters
instead of the whole field.

## Non-goals

- Rankings, stage-winner hit factor, field median, division distributions.
  Their absence is the design constraint, not an omission.
- Screen wake lock, offline persistence, a separate landscape layout.
- Replacing the coaching view or the comparison table. Both stay.

## Surface

The grid owns `effectiveMode === "live"` when
`match.is_live_scores_accessible` is true. A "Full analysis" control switches
to the existing comparison stack; the choice persists per match in
`lib/competition-store.ts` next to `modeOverride`.

Presentation is `position: fixed; inset: 0; height: 100dvh`, body scroll
locked, `env(safe-area-inset-*)` honoured. No site header, no footer, no
`max-w-6xl`. Bands top to bottom:

1. **Title bar** -- match name, row source, freshness dot (`--perf-green`),
   close.
2. **Source toggle** -- My squad / Tracked, plus a row count.
3. **Stage rail** -- one segment per stage, all visible even though about four
   columns fit. `--perf-green` = squad finished, `--foreground` = live edge,
   `--border` = pending. Tap to jump.
4. **Grid** -- shooter column pinned via `position: sticky; left: 0`, stage
   columns `scroll-snap-align: start`. Opens scrolled to the live edge, which
   is the newest stage with any result among the visible rows.

Rows come from `MatchResponse.squads[].competitorIds` or the tracked shooter
IDs, both already present in the cached `GetMatch`. Cap is a new
`MAX_LIVE_GRID_ROWS = 20`, separate from `MAX_COMPETITORS = 12`, because a
squad can exceed 14.

## Cell

Hit factor (15px, tabular), time (10px, muted), and then the zone story --
but only when there is one.

- **Points dropped** -- proportional A/C/D bar reusing `hit-zone-bar.tsx`
  (pattern-filled, already CVD-cleared), plus M/NS/P shape pips with counts.
- **Clean run** -- a 7px green circle and the label `ALL A`. Circle is the one
  shape neither the bar (rectangle) nor the pips (square, triangle, diamond)
  use, so it separates on shape alone under greyscale and CVD.
- **Non-scored** -- `DQ`, `ZERO`, or an em dash for not-yet-shot.

An all-alpha run is the best thing that can appear on the page, so it earns a
positive mark. Drawing nothing would have made "clean" and "no data"
identical.

Column width is about 74px, which fits roughly four stages at 390px and about
ten in landscape.

## Detail sheet

Tapping a cell opens a bottom sheet: hit factor to four decimals, time, points
against stage max, a per-zone breakdown with what each zone cost, the
points-dropped split (on-target vs penalties), the hit factor the run would
have had if clean, and the scorecard timestamp.

Every figure is derived from that shooter's card plus `max_points`. The sheet
is where field context would be most tempting to add; it must not be.

## Data contract

`GET /api/live-grid?ct=&id=&competitor_ids=`

```ts
interface LiveGridCell {
  hf: number | null;
  time: number | null;
  points: number | null;
  a: number | null; c: number | null; d: number | null;
  m: number | null; ns: number | null; p: number | null;
  status: "scored" | "dq" | "zeroed" | "not_fired" | "incomplete" | "pending";
  created: string | null;   // drives live-edge detection
}

interface LiveGridResponse {
  match_id: number;
  stages: { stage_id: number; stage_num: number; name: string; max_points: number }[];
  shooters: { id: number; shooterId: number | null; name: string;
              competitor_number: string; division: string | null; squad: string | null }[];
  cells: Record<number, Record<number, LiveGridCell>>;  // [competitorId][stageId]
  cacheInfo: CacheInfo;
  scorecardsRestricted?: boolean;
}
```

`ns` maps from SSI's `penalty` field, per `lib/scorecard-data.ts:96`.

The invariant: **every field is derivable from one shooter's own scorecard.**
No `group_leader_hf`, `overall_leader_hf`, `field_median_hf`,
`divisionDistributions`, rankings, archetypes, or fingerprints. `max_points`
comes from the stage list. Any within-grid relative measure is computed
client-side from the rows already loaded.

That invariant is what makes phase 2 a server-only change.

## Phasing

**Phase 1 -- project the cached snapshot.** The route reads the existing
scorecards snapshot through `getMatchScorecards` and projects it down. It must
not call `computeGroupRankings` or any field-wide compute. Ships without
touching upstream, so it is not blocked on SSI's weekday-only API key.

Phase 1 delivers no upstream reduction. It buys the view, the contract, and
courtside testing.

**Phase 2 -- per-competitor fetch, behind `LIVE_GRID_PER_COMPETITOR=on`.**
SSI exposes an unused per-competitor path:

```
RootQuery.competitor_scorecards(content_type, id, updated_after) -> [ScoreCardInterface!]!
RootQuery.competitor_scorecards_count(content_type, id) -> Int!
IpscCompetitorNode.scorecards(updated_after) / .scorecards_count / .latest_scorecard_update
```

Watermarked by `latest_scorecard_update` exactly like the existing stage
sidecar, cached per competitor (`sc:comp:{ct}:{compId}`) so overlapping
squad-watchers share keys.

### Phase 2 is gated on a spike

`scripts/spike-competitor-scorecards.ts` is written but could not run --
SSI returned `Invalid API Key!` because the key is enabled on weekdays only.
It must answer three questions before phase 2 is planned:

1. Does the root `competitor_scorecards` resolver work? The sibling root
   `competitor(content_type, id)` returns 404 in practice
   (`lib/graphql.ts:268`), so this cannot be assumed.
2. Does GraphQL alias-batching of N competitors in one request work?
   **This is the load question.** 14 competitor requests is worse than 12
   stage requests on request count, which is what caused the 2026-08-15
   outage. The payload win is real either way; the request-count win depends
   entirely on batching.
3. Does the path respect `is_live_scores_accessible`?

If batching fails, phase 2 is only worthwhile when the watched-competitor set
stays a small fraction of the field. Decide then, with numbers.

## Refresh contract

The grid reuses `computeMatchFreshness` unchanged and introduces **no second
poll clock**. A separate clock on the same match would raise refresh frequency
and defeat the purpose. Probe gating, single-flight locks, the upstream
semaphore, and `SSI_UPSTREAM_PAUSED` all apply untouched.

Instrument the same way as the 2026-08-20 measurement (234 client requests ->
25 upstream calls) so the phase 2 before/after is measured, not asserted.

## Design system

**Zero new tokens.** Everything resolves to `--background`, `--card`,
`--foreground`, `--muted-foreground`, `--border`, `--primary`,
`--destructive`, and the `--perf-red` / `--perf-amber` / `--perf-green`
triad, plus the four zone literals already in `hit-zone-bar.tsx`
(`#22c55e`, `#facc15`, `#fb923c`, `#dc2626`). The rail's done and live states
use `--perf-green` and `--foreground` rather than a new accent.

"This is me" uses the shipped badge from `competitor-picker.tsx:148`
(`bg-primary/10`, `text-primary`, uppercase), not a coloured name.

## Accessibility

- Grid is a real `<table>` with `<th scope="col">` per stage and
  `<th scope="row">` per shooter.
- Cells are `<button>` elements; the sheet is `role="dialog" aria-modal="true"`
  and returns focus to the originating cell on close.
- No information rests on colour alone: zone bar uses pattern fills, penalties
  use distinct shapes, the clean marker uses a circle plus the text `ALL A`.
- Touch targets meet the 44x44px floor from `globals.css`. Cells are visually
  smaller than that, so the tap target must be padded to meet it -- verify.
- Rail buttons carry `aria-label="Jump to stage N"`.

## Testing

- **Unit** -- the projection from raw scorecards to `LiveGridResponse`, as a
  pure function, including DQ / zeroed / not-fired / incomplete and a
  mid-scoring stage where some rows have no card.
- **Component** -- cell renders the clean marker when and only when
  `c + d + m + ns + p === 0`; renders the bar otherwise.
- **E2E** -- Playwright at 390px: live-edge auto-scroll, rail jump, sheet open
  and close, no horizontal page overflow.
- Existing gates apply: `pnpm -w run lint`, `pnpm -w run typecheck`,
  `pnpm -w test` all clean.

## Open questions

1. Does `ALL A` read as too shouty outdoors? The circle alone may carry it.
   Answer courtside.
2. `CACHE_SCHEMA_VERSION` does not move in phase 1 -- the route reads the
   existing cached shape and adds no fields to it. Confirm during
   implementation.
3. Whether the grid should also serve `results_status === "all"` matches that
   are complete but where the user still wants the compact view. Out of scope
   for now.
