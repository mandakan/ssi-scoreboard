# Match tabs -- a mobile-first restructure around the courtside grid

Design doc. Status: draft 2026-09-29, pending review.

Predecessor: `2026-08-23-live-grid-design.md` (the grid itself). Grid
sticky-column snap bug fixed separately in #560.

## Problem

The match page tries to be three products behind one toggle. A phone user
scrolls past a top row, banners, the header, a results disclaimer, the
Pre-match / Live / Coaching toggle and a four-button picker row before any
data appears. Coaching mode then stacks six bordered cards and up to six
320-360px charts before the collapsibles. `match-page-client.tsx` is 1560
lines; `comparison-table.tsx` is 2373. The courtside grid -- the feature
people actually use on match day -- is a full-screen overlay reached through
the mode machinery.

Global chrome adds to it: bottom nav (56px, ~110px with an install/update
banner stacked on top), a tall footer on every page, a What's New modal that
auto-opens on each release, and eleven 320px-wide help popovers on a 390px
screen.

## Evidence (R2 usage telemetry, 2026-08-30 to 2026-09-29)

| Signal | 30 days | Reading |
|---|---|---|
| Live comparison requests | 1719 | Polls every 30s: ~14 h of live-table viewing, clustered on match weekends. Persisted after the grid became default. |
| Coaching comparison requests | 61 | Non-polling: ~2 coaching opens per day. |
| Match views | 238 | 161 active, 66 complete, 11 pre-match. |
| Shooter dashboard views | 215 | Steady. |
| Stage-time export | 0 | UI and MCP. |
| Grid usage | unknown | `/api/live-grid` emits no usage event. |

Conclusions: live is where users are; they want more than the grid during a
match (Analysis must work live, not only post-match); coaching depth is a
niche; the export is unused but stays in the UI (decision 2026-09-29).
Telemetry is server-side only, so it cannot say which charts or sections are
opened -- hence the telemetry work in PR 1.

## Decisions

1. The grid **is** the match page. Deep analysis moves to its own tab.
2. Same page shape through the match day: the grid before (empty cells),
   during and after the match. Pre-match info lives in an Info tab.
3. Inside a match, a **match tab bar** (Grid / Info / Analysis) replaces the
   global bottom nav. A back arrow returns to the app.
4. Analysis **starts from the grid's rows**; its picker lives only in
   Analysis; edits there never change the grid.
5. Analysis content: keep the comparison table (default), merge five charts
   into one switchable Charts card, keep focus areas, fold coaching analyses
   plus simulator plus stage-time export into a collapsed Deep dive, add
   telemetry.
6. Implementation approach: nested routes under a shared match layout
   (chosen over a `?tab=` query param or an in-place toggle swap).

## Section 1 -- Routes, layout, state

```
app/match/[ct]/[id]/
  layout.tsx          server: generateMetadata (moved from page.tsx),
                      prefetch match query once, HydrationBoundary
  match-shell.tsx     client: top bar + tab bar, persists across tabs
  page.tsx            Grid (index route)
  info/page.tsx       Info
  analysis/page.tsx   Analysis
```

**Shell.** Top bar: back arrow, match name, scoring indicator
(`● 7/12 stages`), and a warning dot when a status notice is active (see
Info). Bottom tab bar: Grid / Info / Analysis, active tab from
`usePathname()`. `BottomNav` and `Footer` hide on `/match/*`. The layout
persists across tab switches, so the match query, its polling and scroll
state survive navigation.

**Grid is no longer an overlay.** Today `LiveGrid` is
`fixed inset-0 z-50 h-[100dvh]` and locks body scroll. It becomes a normal
flex child filling the space between top bar and tab bar. The body-scroll
lock and the z-index contest with `UpdateBanner` go away.

**Mode machinery removed.** The route replaces Pre-match / Live / Coaching:
`ModeToggle`, `ssi_mode_{ct}_{id}` overrides and `ssi_liveview_{ct}_{id}`
preferences are deleted (stale keys are ignored, not migrated).
`detectMatchView` survives only as far as Analysis needs it to decide live
polling vs coaching fetch (Section 3).

**Analysis selection.** `/analysis?competitors=` is the single source of
truth, as today. With no param and no saved selection, Analysis seeds from
the grid's resolved rows (`resolveGridRows` output, capped at
`MAX_COMPETITORS`). An explicit edit is persisted per match in the existing
`ssi_competitors_{ct}_{id}` key. Nothing in Analysis writes grid state.

**Grid row source persisted.** `gridSource` (squad / tracked) is saved per
match in localStorage; today it resets to squad on every mount.

**Old links.**
- `/match/{ct}/{id}?competitors=...` -> server redirect to
  `/match/{ct}/{id}/analysis?competitors=...`. Covers shared links and
  shooter-dashboard links (`shooter-dashboard-client.tsx:227, 396`).
- `#stage-N` anchors (`anchor-stage-card.tsx:26`) point at
  `/analysis#stage-N`.
- Plain `/match/{ct}/{id}` links (home, search, recent, Discord bot) land on
  the grid -- intended.
- Implemented as a pure helper (`resolveLegacyMatchUrl()`) called from the
  index `page.tsx`, so it is unit-testable.

**Forced fixes.**
- `share-button.tsx` builds its OG URL by rewriting the pathname; strip any
  `/info` or `/analysis` suffix first, or the OG image 404s.
- `isSameMatchSoftNav` in `page.tsx` compares the referer to the exact match
  path; switch to prefix match so tab switches are not counted as new
  `match-view` events. `match-view` emission moves to the layout.
- `generateMetadata` keeps reading `searchParams.competitors` for the
  multi-competitor OG image -- on the analysis page, since layouts do not
  receive `searchParams`.

## Section 2 -- Grid and Info tabs

**Grid chrome.** Match name moves to the shell top bar; the "Full analysis"
button is removed (tab bar replaces it). Remaining grid chrome is one row:
squad / tracked chips on the left, stage rail on the right. Two header rows
fewer than today.

**States.**
- Pre-match: every cell pending, rail grey, plus a compact strip above the
  grid -- your squad, first stage in your rotation, weather -- tapping
  through to Info.
- Live: as today; auto-scroll to the live-edge stage (snap fix from #560).
- Complete: rail fully green, final scores.
- No rows (no identity, no tracked, no selection): "Pick your squad" empty
  state with the squad picker inline. Replaces today's blank page.
- Live scores not public: grid area explains and links to Info.

The field-blind contract (`docs/live-grid.md`) and "never call
`/api/compare` while the grid shows" are unchanged and stay e2e-guarded.

**Manage tracked.** A "Manage" action next to the Tracked chip opens the
existing `TrackedShootersSheet`.

**12px floor.** Grid labels at 9.5-10px (column headers, division line,
tracking-wide captions) move to 12px per CLAUDE.md. The name column widens
from 94px to ~104px to fit the division line. The width lives in one shared
constant used for the column classes, the `scroll-padding-left` from #560,
and the rail-jump offset.

**Info (`/info`).** Slimmed `PreMatchView`, useful in every match state (not
gated to pre-match). Order:
1. Match facts: venue, date, level, SSI link, share.
2. Status notices: results not published, match cancelled, upstream
   degraded / paused. Moved from the top of today's match page. The shell's
   top bar shows a warning dot while any is active.
3. Your squad and stage rotation.
4. Weather.
5. AI brief (manual trigger, as today).
6. Registered field (collapsed by default).

Existing sub-components are reused; the change is ordering and gating.

## Section 3 -- Analysis tab and telemetry

**Order.**
1. Selection summary: one row, `Comparing: Anna L., Erik S. +1 ▾`. Opens a
   sheet containing `CompetitorPicker`, `SquadPicker`, `BenchmarkPicker`,
   Clear, and "Reset to grid shooters". Undo toast unchanged.
2. Focus areas (only when you are among the selected).
3. Stage results: existing `ComparisonTable`, unchanged here. Mobile rework
   is a separate spec.
4. Charts: one card, a horizontally scrollable chip switcher -- HF by stage,
   HF% vs stage winner, division position (when data exists), speed vs
   accuracy, stage balance radar. One chart mounted at a time. Last choice
   remembered per viewer in localStorage (wrapped in try/catch). The card's
   `?` popover content follows the selected chart (satisfies the
   chart-popover rule in CLAUDE.md).
5. Deep dive (collapsed): the seven coaching analyses, stage simulator
   (existing >=80% scored gate), and the stage-time export.

**Live vs complete.**
- Match active: table and charts use `mode=live`, polling every 30s.
- Opening Deep dive while live fires one `mode=coaching` compare request,
  no polling. Preserves today's ability to force coaching mid-match without
  a mode toggle. Computed from the cached scorecard snapshot -- no extra
  upstream calls.
- Match complete: `mode=coaching` directly, as today.

**Query scoping.** `useCompareQuery`, and the career-baseline
`useShooterDashboardQuery`, run only on the Analysis route -- never on Grid
or Info.

**Popovers.** All help popovers get `max-w-[calc(100vw-2rem)]` instead of a
fixed `w-80`.

**Telemetry.**

Server-side:
- New usage op `live-grid-view` from `/api/live-grid`: `ct`, bucketed row
  count. Polls every 30s like `comparison`, so it measures time-in-view and
  is directly comparable to live-table time.

Client-side, new endpoint `POST /api/telemetry/ui` via `navigator.sendBeacon`
(fetch `keepalive` fallback):
- Zod allowlist, discriminated on `op`:
  - `tab-view` -- `tab: "grid" | "info" | "analysis"`
  - `analysis-section-open` -- `section: "charts" | "deep-dive" | "simulator"`
  - `chart-switch` -- `chart: <enum of chart ids>`
  - `stage-export` -- `surface: "ui"` (slot already reserved in the type)
- Payload: `ct` plus the enum values only. No match id, shooter id,
  competitor id or free text. Unknown ops or fields -> 400, not logged.
- Per-IP rate limit on the endpoint; IP is never logged.
- Server forwards to `usageTelemetry()` so events land in the same R2
  stream with `domain: "usage"`.
- Update `docs/telemetry.md` and `/legal` Section 6
  (`app/legal/page.tsx:190`) in the same PR.

## Section 4 -- Global chrome, desktop, testing, rollout

**What's New.** No auto-open modal. An unseen release shows a dot on the
More tab (mobile) and the header entry (desktop); opening marks it seen.
Update `docs/whats-new.md`.

**Banners.** `InstallBanner` / `UpdateBanner` sit above whichever bottom bar
is present (global nav, or match tab bar) via a `--bottom-chrome-h` CSS
variable set by the active layout. `UpdateBanner` moves below sheets and
dialogs in z-order.

**Footer and nav.** Hidden on `/match/*` (Section 1).

**Desktop (md+).** Site header stays. Match tabs render as a horizontal tab
strip under the match title instead of a bottom bar. Grid gets a max width.
Enhancement only -- nothing designed desktop-first.

**Accessibility.** Tab bar is `<nav aria-label="Match sections">` with links
and `aria-current="page"` -- real routes, not an ARIA tablist. 44px targets.
Charts switcher chips are buttons with `aria-pressed`. Deep dive follows the
accordion pattern in CLAUDE.md (`<hN><button aria-expanded aria-controls>`,
region with `aria-labelledby`).

**Unit tests.**
- Telemetry allowlist schema (accepts each op, rejects unknown ops, extra
  fields, and any id-shaped field).
- `resolveLegacyMatchUrl()` -- `?competitors` and `#stage-N` handling.
- Share-button OG URL strips tab suffixes.
- Analysis seeding from grid rows (no param, no saved selection).
- Same-match soft-nav detection across all three tab paths.

**E2E.**
- Existing suites moved to new URLs (`scoreboard.spec.ts`,
  `drawer-collapsible-toggle.spec.ts`, `live-grid.spec.ts`).
- New: tab navigation; legacy `?competitors` redirect; no horizontal
  overflow at 390px on each tab; `/api/compare` never called on Grid (kept);
  What's New does not auto-open.

**Screenshot scenes.** `scripts/screenshot-match.ts` scenes move to the new
paths; the live-grid scene no longer needs `ssi_mode_*` / `ssi_liveview_*`
seeding.

**Rollout.** Separate PRs to `main`, in order:

1. **Telemetry** -- `live-grid-view`, `/api/telemetry/ui`, legal and docs.
   Released on its own immediately, to collect at least one match weekend
   of baseline before the restructure ships.
2. **Shell and routes** -- layout, shell, tab bar, three routes with today's
   content rearranged, legacy redirect, share / soft-nav fixes, mode
   machinery removed.
3. **Analysis restructure** -- selection summary sheet, Charts switcher,
   Deep dive (incl. export), query scoping, popover widths.
4. **Info tab** -- reorder, un-gate from pre-match, status notices moved,
   grid pre-match strip, grid 12px floor and 104px name column.
5. **Chrome** -- What's New dot, banner offsets, desktop tab strip; plus
   the `RELEASES` entry and updated screenshots.

Production deploys only when the release-please PR merges, so the release
is held until PRs 2-5 are all in; users see one coherent change. Staging
receives each PR as it merges for on-phone testing.

## Out of scope

- Mobile rework of `ComparisonTable` (own spec).
- Cutting coaching analyses -- revisit once PR 1 telemetry has data.
- Shooter dashboard and home page restructuring.
- Grid Phase 2 (per-shooter upstream fetch, see the live-grid spec).
