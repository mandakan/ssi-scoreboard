# What's New dialog

The "What's New" dialog never opens by itself. When a new entry has been added, a dot marks
the "What's new" entry point until the user opens it: on the More button of the bottom nav
(mobile) and on the header button (desktop). The footer is hidden on match pages, so it is
not the entry point there.

## To announce a new release

1. Open `lib/releases.ts`.
2. **Prepend** a new `Release` object to the `RELEASES` array (newest entry must always be first).
3. Set `id` to an ISO date string (e.g. `"2026-03-15"`) — this is the key stored in
   `localStorage("whats-new-seen-id")`. The dot shows whenever this `id` differs from
   what the user's browser last saw; opening the dialog stores it and clears the dot.
4. Fill in `date` (human-readable), optional `title`, and one or more `sections`
   (`heading` + `items` string array).

```ts
// lib/releases.ts -- example new entry
{
  id: "2026-03-15",
  date: "March 15, 2026",
  title: "Squad View & Performance Trends",
  sections: [
    {
      heading: "New",
      items: [
        "Squad view: filter the comparison table to a single squad.",
        "Performance trend sparklines on the stage list.",
      ],
    },
    {
      heading: "Improved",
      items: ["Faster initial load on slow connections."],
    },
  ],
},
```

## Key files

- `lib/releases.ts` — the only file you edit to publish a new What's New
- `lib/types.ts` — `Release` / `ReleaseSection` interfaces
- `components/whats-new-provider.tsx` -- context, unseen state, dialog render
- `components/bottom-nav.tsx` -- More button (with the dot) and its "What's new" item on mobile
- `components/site-header.tsx` -- desktop header button (with the dot)

**Rule of thumb:** add an entry whenever a user-visible feature ships. Skip patch/fix-only
deploys unless the fix is prominent enough that users should know about it.

## screenshotScenes

New releases must include a `screenshotScenes` array. Point it at the scenes from
`scripts/screenshot-match.ts` that best showcase the new feature. Each scene is captured
at both mobile (390x844) and desktop (1280x900).

Current catalogue: `comparison-table`, `degradation-chart`, `hf-level-bars`,
`archetype-chart`, `style-fingerprint`, `stage-times-export`, `live-grid`, `match-info`,
`pre-match-grid`, `shooter-dashboard`, `competitor-identity`, `tracked-shooters-sheet`,
`whats-new-dialog`. Omit the field
to capture all.

**When to add a new scene:** if a new chart or UI section isn't well-represented by any
existing scene, add one to `scripts/screenshot-match.ts` (follow the existing `Scene`
pattern: `name`, `description`, `suppressWhatsNew`, `setup`). If the new section is inside
the "Deep dive" accordion, call `openCoachingSection(page)` before scrolling.
Update the catalogue list above and in `docs/release-post.md` whenever scenes are added.
