# Coaching Features -- Information Architecture

Companion to `docs/coaching-features-research.md`. Locks the target end-state
for the five Tier 1 coaching features (issues #462-#466) before any of them
start, so order-of-implementation doesn't dictate hierarchy.

Scope: the **match page** (`app/match/[ct]/[id]/match-page-client.tsx`) and
the **shooter dashboard** (`app/shooter/[shooterId]/shooter-dashboard-client.tsx`).
Everything else is unchanged.

This doc is PR-blocking: every PR for #462-#466 must reference it in the
description and tick the checklist in §6.

---

## 1. Design principles for this batch

The five features are additive synthesis over data we already display.
They have to land without turning two already-dense pages into a wall of
cards. The principles below resolve every layout call in this doc.

1. **Identity-gated coaching surfaces.** Anything that synthesises a
   *specific shooter's* performance only renders when the viewer's
   `MyShooterIdentity` (from `lib/shooter-identity.ts`) matches a
   competitor on the current page (match page) or owns the dashboard
   (shooter dashboard). Anonymous and casual viewers see today's page
   shape, unchanged. This keeps the casual-viewer path untouched and
   reserves prime real estate for the user who can actually act on it.
2. **Synthesis above analytics.** When the viewer is identified, the
   ranked synthesis (focus areas) sits above the raw analytics
   (stage results table, 9 charts). Reading order matches decision order.
3. **No new toggles for identity-gated content.** Overlays that only
   render for the viewer's own identity render by default; no opt-in
   UI surface. Power-user disablement is a future settings concern, not
   a per-chart switch.
4. **Reuse the existing `?` info popover convention.** Every new section
   gets one, matching the chart sections already in the match page (per
   CLAUDE.md's "Chart info popovers" rule).
5. **Mobile-first at 390px.** Every wireframe in §3 / §4 is drawn at
   390px. Desktop is a one-column-becomes-two enhancement, not a
   different IA.

---

## 2. Locked-in decisions (from the IA review)

| # | Decision | Reasoning |
|---|---|---|
| 1 | **Focus areas (#462)** sits above the stage results table on the match page, **identity-gated**. | Lead the page with synthesis for users who can act. Casual viewers see today's page unchanged. |
| 2 | **Compare-to-self overlay (#463)** auto-renders on the affected charts when viewer identity matches a competitor; **no toggle**. | Identity already gates visibility; an explicit toggle is redundant choice fatigue. |
| 3 | **Dashboard order (#464 + #465)** becomes: identity -> aggregates -> **anchor stage** -> **near achievements** -> trends -> upcoming -> history -> achievements grid. | Hero ceiling first (confidence cue), then near-term goals (action cue), then chronological context. |
| 4 | **Pre-match brief (#466)** stays in its current component slot; only the prompt and the deterministic hooks layer change. | No IA change; behavioural change only. |

---

## 3. Match page target state

### 3a. Identified viewer (the shooter is one of the competitors)

```
+------------------------------------------+
| Match header: name, date, level, link    |
| Squad / division chips                    |
+------------------------------------------+
| View toggle: pre-match | live | coaching |
+------------------------------------------+
| Competitor picker                         |
+------------------------------------------+
| FOCUS AREAS  [?]                          |  <-- NEW (#462)
| 1. Mistake reduction        high  -8.2%  |
|    Penalties cost 12% of your match %.   |
|    [Jump to penalty breakdown ->]         |
| 2. Weak hand                med   -3.1%  |
| 3. Long stages              med   -2.4%  |
+------------------------------------------+
| Stage results (table)                     |
+------------------------------------------+
| Hit factor by stage  [?]                  |
|   ...bars + ghost: career median  <-- #463
+------------------------------------------+
| HF% vs stage winner  [?]                  |
|   ...bands + ghost: career median  <-- #463
+------------------------------------------+
| Division position  [?]                    |
+------------------------------------------+
| Speed vs accuracy  [?]                    |
+------------------------------------------+
| Stage balance (radar)  [?]                |
|   ...solid + dashed: career median  <-- #463
+------------------------------------------+
| Shooter style fingerprint  [?]            |
| Shooter style profile  [?]                |
| Stage degradation  [?]                    |
+------------------------------------------+
| Coaching mode (expanded by default)       |
|   AI coaching tip                          |
|   Course length summary                    |
|   Constraint summary                       |
|   Archetype performance                    |
|   Stage simulator                          |
+------------------------------------------+
```

### 3b. Anonymous or casual viewer (not one of the competitors)

```
+------------------------------------------+
| Match header                              |
| View toggle                               |
| Competitor picker                         |
+------------------------------------------+
| Stage results (table)         <-- top of fold
+------------------------------------------+
| ...9 charts as today                      |
+------------------------------------------+
| Coaching mode (collapsible, as today)     |
+------------------------------------------+
```

No FOCUS AREAS section. No ghost overlays on charts. Page renders
exactly as it does today. **This is the test for whether identity-gating
is working correctly.**

### 3c. Disclosure rules

- **Focus areas:** at most 3 cards, always expanded. No collapse.
  Sample-size guards inside the rule engine ensure the list is short.
- **Ghost overlays:** rendered as a secondary visual layer with reduced
  opacity (~0.5) and dashed stroke. Legend swatch uses
  `CompetitorMarker` so colour + shape stay paired (per CLAUDE.md WCAG
  1.4.1 rule).
- **Coaching mode collapsible:** stays as it is today (expanded by
  default in coaching mode, collapsible by user). Do not move existing
  sections into or out of it as part of this batch.

### 3d. Mobile-first at 390px

- Focus-area cards stack vertically; each card is full-width inside the
  16px page gutters.
- The "jump to chart" link on each focus-area card is a `<a>` not a
  `<button>` (it does an in-page anchor scroll). Min height 44px.
- Ghost overlay on the radar must not narrow the radar's existing
  minimum size at 390px. If the legend grows past one line, it wraps;
  it does not push the chart further down.

---

## 4. Shooter dashboard target state

### 4a. Own dashboard (viewer's identity matches `shooterId`)

```
+------------------------------------------+
| Identity hero: name, photo, division     |
| "This is me" / "Track" buttons            |
+------------------------------------------+
| Aggregate cards (matches, HF, A%, ...)    |
+------------------------------------------+
| ANCHOR STAGE  [?]                         |  <-- NEW (#465)
| 98.2% of stage winner                     |
| Stage 4, SPSK Open 2025                   |
| Production Optics -- weak-hand only       |
| [Open match ->]                           |
+------------------------------------------+
| NEAR ACHIEVEMENTS  [?]                    |  <-- NEW (#464)
| 1-3 cards, sorted by smallest delta       |
| [Silver -2 matches] [Bronze -1 ZA stage]  |
| [Variety -3 divisions]                    |
+------------------------------------------+
| Trends (HF / Match% / A% / Pen / CV)       |
|   ...with "above/below trend" badge <-- #463
+------------------------------------------+
| Upcoming matches                          |
| Match history                             |
| Achievements grid                         |
+------------------------------------------+
```

### 4b. Someone else's dashboard

```
+------------------------------------------+
| Identity hero                             |
| "Track this shooter" button               |
+------------------------------------------+
| Aggregate cards                           |
+------------------------------------------+
| ANCHOR STAGE  [?]   (still rendered)      |
+------------------------------------------+
| Trends (no "above/below trend" badge)     |
| Upcoming matches                          |
| Match history                             |
| Achievements grid                         |
+------------------------------------------+
```

- Anchor stage **always** renders when the underlying shooter has
  N >= 10 stages; it's not about *who is viewing*, it's about the
  subject of the dashboard.
- Near achievements **always** renders for the dashboard's subject
  (it's their progress, not the viewer's).
- The "above/below trend" badge on the trend cards is the only
  identity-gated dashboard surface (because it compares the viewer's
  *current* match -- which doesn't exist when viewing someone else).
  Drop the badge silently for non-owner viewers.

### 4c. Mobile-first at 390px

- Aggregate cards: existing 2x2 grid pattern stays. No change.
- Anchor stage: single full-width card; hero number large
  (`text-3xl` minimum); secondary metadata wraps below.
- Near achievements: vertical stack of up to 3 cards at 390px.
  At >=640px (`sm:`), they become a 3-column grid. Avoid
  horizontal scroll patterns on mobile -- the research IA review
  explicitly preferred stack over scroll because horizontal scroll
  rows hide content from screen readers and one-handed users.

---

## 5. Pre-match brief evolution (#466)

No layout change. The brief component sits in its existing slot in the
pre-match view. Only the data feeding it changes:

- When the viewer is identified, the brief route receives the viewer's
  `shooterId`, computes deterministic "hooks" from their last-5-match
  aggregates + this match's stage shape, and passes the hooks to the AI
  prompt as structured input.
- When the viewer is anonymous, behaviour is identical to today --
  generic brief, no personalisation.

The IA implication is **negative**: do not add any new UI element to
indicate "this is personalised" beyond what the brief copy itself
naturally signals. No badge, no toggle, no settings.

---

## 6. PR-blocking checklist

Every PR that touches the match page or dashboard for #462-#466 must
tick every applicable box. PRs that don't are returned without review.

### Identity gating

- [ ] If the section is identity-gated per §1 / §2, it renders only
      when `MyShooterIdentity` matches the appropriate shooter.
- [ ] Anonymous viewers see today's page unchanged (regression test
      in `tests/e2e/` that loads the match page without setting
      `ssi-my-shooter` localStorage).

### Hierarchy and order

- [ ] Section order on match page matches §3a / §3b exactly.
- [ ] Section order on dashboard matches §4a / §4b exactly.
- [ ] No section displaces an existing section without being listed
      in §3 or §4.

### Accessibility (WCAG 2.1 AA -- per CLAUDE.md + Web Interface Guidelines)

- [ ] Every new section uses `<section aria-labelledby="...">` with a
      unique label; no two sections share an accessible name.
- [ ] Every new heading is the next sequential level (no h2 -> h4 skips).
- [ ] Every new `[?]` info popover follows the existing pattern:
      `<button aria-label="About ...">` with `HelpCircle` marked
      `aria-hidden="true"`, popover content is
      `<section role="region" aria-labelledby="...">`.
- [ ] Disclosure / collapsible sections use
      `<hN><button aria-expanded aria-controls>` -- never a heading
      element nested inside a button.
- [ ] Color is never the sole means of conveying focus-area severity
      or ghost-overlay identity; pair with text + shape + opacity
      (use `CompetitorMarker` / pattern fills as elsewhere).
- [ ] All interactive elements have `:focus-visible` ring; no
      `outline-none` without a replacement.
- [ ] Touch targets >= 44x44px (already enforced globally in
      `globals.css`; verify new buttons don't override).
- [ ] Decorative icons get `aria-hidden="true"`.
- [ ] Form fields (none expected in this batch) use `<label htmlFor>`.

### Mobile-first at 390px

- [ ] No horizontal page overflow at 390px viewport.
- [ ] Focus-area cards stack vertically at <640px.
- [ ] Anchor stage hero number stays readable at 390px (>= text-3xl).
- [ ] Ghost overlay legend wraps; doesn't push chart further down.
- [ ] Near achievements stack vertically at <640px (no horizontal
      scroll row).

### Data and content

- [ ] Empty / N-too-low states render explicit copy, not an empty
      card frame (focus areas: hide section entirely when 0 rules
      fire; anchor stage: hide entirely when N < 10).
- [ ] All text containers handle long content (`truncate`,
      `line-clamp-*`, or `break-words`) -- match names get long.
- [ ] Images / icons with intrinsic size declare width + height.

### Performance

- [ ] No new GraphQL call introduced by #462-#465 (everything is
      synthesis over existing `CompareResponse` / shooter dashboard
      data; #466 reuses the existing brief route).
- [ ] No layout reads in render
      (`getBoundingClientRect`, `offsetHeight`).
- [ ] Animations honour `prefers-reduced-motion` (ghost overlay
      should not animate on first paint when reduced-motion is set).

### Telemetry and privacy

- [ ] No raw text, no shooter IDs, no competitor IDs in new
      telemetry events (per CLAUDE.md telemetry rule). Bucketed
      counts only.
- [ ] No personal text is sent to the server (the focus-area rule
      engine is server-side but operates on already-server-side
      data).

### Tests

- [ ] Pure helpers (focus-area rules, career baseline,
      near-achievement deltas, anchor-stage selection) have unit
      tests in `tests/unit/` with fixture inputs.
- [ ] E2E test (`tests/e2e/`) loads a match page as anonymous and
      asserts the identity-gated sections do NOT render.
- [ ] `pnpm -w run lint && pnpm -w run typecheck && pnpm -w test`
      all clean.

---

## 7. Out of scope for this batch

Listed here so future PRs can be redirected without re-litigating:

- A page-level "compare to your career" master toggle (decision #2
  rules it out; revisit only if users explicitly request it).
- Moving existing chart sections into / out of the coaching-mode
  collapsible (intentionally untouched in this batch).
- Settings UI for disabling overlays (a future settings concern, not
  per-chart).
- A "Coaching" tab pattern on the match page (rejected during IA
  review; revisit only if the page grows past ~15 sections, which
  this batch does not push it to).
- Achievement nudges as push / email notifications (would require
  identity beyond `MyShooterIdentity` -- out of §5 scope in the
  research doc).

---

## 8. Open questions for the next pass

- The brief evolution (#466) doesn't change layout but does change
  perceived behaviour. Should the brief copy itself signal
  "personalised based on your last matches" so the difference is
  legible to the user? Lean: no, the copy speaks for itself; revisit
  if users tell us they didn't notice the change.
- If a fourth focus-area rule fires (e.g., DQ + 3 high-confidence
  others), the cap is 3. Verify the rule engine's ordering is the
  user-facing priority order and not lexicographic.
- The "above/below trend" badge on the dashboard trends section --
  position relative to each individual trend card vs. one badge on
  the trends section header? Lean: per-card, since each metric can
  trend differently.
