import type { Release } from "@/lib/types";

/**
 * Release history — newest entry first.
 *
 * To show a "What's new" dialog for a new release:
 *   1. Prepend a new Release object with a unique `id` (ISO date recommended).
 *   2. Fill in the sections with user-facing highlights.
 *
 * The dialog auto-shows once per browser profile whenever RELEASES[0].id
 * differs from the value stored in localStorage("whats-new-seen-id").
 */
/** The `id` of the newest release. Used by e2e tests to suppress the What's New dialog. */
export const LATEST_RELEASE_ID = "2026-04-28-competitor-selection";

export const RELEASES: Release[] = [
  {
    id: LATEST_RELEASE_ID,
    date: "April 28, 2026",
    title: "Faster competitor selection",
    screenshotScenes: ["comparison-table", "tracked-shooters-sheet"],
    sections: [
      {
        heading: "New",
        items: [
          "Smart benchmark presets — once you set 'this is me' in My Shooters, the Benchmark button gives one-tap shortcuts: One above me, One below me, My division podium, My percentile cohort (p25/p50/p75/p95), and Same club. Each preset replaces your current selection and you can undo right away.",
          "Reorder competitors directly in the comparison table — each column header has chevron buttons to move a competitor left or right. Column colors follow the new order, so you can put yourself in column 1 and keep the same color across matches.",
          "Tap the star next to a competitor's name in the comparison table header to favorite or unfavorite them without leaving the page. The same star is now also on the shooter dashboard.",
          "Squad picker now replaces your current selection (with a one-tap undo) instead of mixing the squad into what was already there.",
          "Clear button next to the picker wipes your selection in one tap, with a 5-second undo.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "The competitor dropdown now groups your favorites at the top — with you pinned first when 'this is me' is set — and the rest below.",
        ],
      },
    ],
  },
  {
    id: "2026-04-28-stage-export",
    date: "April 28, 2026",
    title: "Stage times export",
    screenshotScenes: ["stage-times-export"],
    sections: [
      {
        heading: "New",
        items: [
          "Post-match coaching now includes a 'Export stage times' section with one-tap JSON and CSV downloads of the per-stage times for the competitors you've selected. Auto-cut a long match recording into per-stage clips, or import the CSV into Resolve / Premiere as markers.",
          "Each row carries an ISO timestamp from the RO submission so editors can align a stage run to a recording timeline.",
          "Same data is also available as the get_stage_times MCP tool for editors using Claude Desktop or Claude Code.",
        ],
      },
    ],
  },
  {
    id: "2026-04-29",
    date: "April 28, 2026",
    title: "Easier on the eyes",
    screenshotScenes: [
      "comparison-table",
      "hf-level-bars",
      "degradation-chart",
      "style-fingerprint",
    ],
    sections: [
      {
        heading: "Accessibility",
        items: [
          "Competitor colors switched to a colorblind-safe palette (Okabe-Ito). Charts no longer rely on color alone -- each competitor also has a distinct marker shape (circle, square, triangle, diamond, cross, star, wye) carried through every chart, table header, and legend.",
          "HF level cell now shows the level digit (1-5) next to the bars, so you can read it at a glance without color cues.",
        ],
      },
      {
        heading: "Hit-zone bar redesigned",
        items: [
          "Taller bar with patterned fills (solid A, light diagonal C, dense diagonal D) so zone composition stays readable in grayscale and under common color-vision deficiencies.",
          "Misses, no-shoots, and procedurals moved out of the bar and into shape-coded pips below it -- a square per miss, triangle per no-shoot, diamond per procedural. One pip per occurrence up to 3, then a count.",
          "Per-stage \"-Xpts\" text removed -- the pips already show what happened. Hover or tap the bar for a full breakdown with point cost.",
          "The total points lost to penalties is still shown on the bottom summary row for each competitor.",
        ],
      },
    ],
  },
  {
    id: "2026-04-28",
    date: "April 28, 2026",
    title: "Find live matches faster",
    // "Live now" is a homepage feature; existing screenshotScenes target the
    // match page only, so no scene is listed here.
    sections: [
      {
        heading: "New",
        items: [
          "Homepage now shows a 'Live now' section listing matches whose scoring is in progress -- one tap to whichever match you're attending or following. The section hides itself when nothing is live.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Live match pages feel snappier, especially during busy weekend events.",
        ],
      },
      {
        heading: "Privacy",
        items: [
          "We now record anonymous server-side telemetry -- page views, feature usage, cache decisions, and upstream timings -- to help diagnose bugs and decide which features to invest in.",
          "Never recorded: IP addresses, your shooter ID, individual competitor IDs, or the text of any search you type.",
          "Recorded as buckets and counts only (e.g. \"1-9 results\" rather than the actual number). Stored on Cloudflare R2 with 30-day automatic deletion.",
          "Full details and the complete \"never recorded\" list: see the Privacy Policy at /legal -- section 6.",
        ],
      },
    ],
  },
  {
    id: "2026-04-27",
    date: "April 27, 2026",
    title: "Heads-up When SSI Is Down",
    sections: [
      {
        heading: "New",
        items: [
          "When ShootNScoreIt isn't responding, the match page now shows a clear 'Live updates paused' banner with how old the displayed scores are, so you know whether you're looking at current data or a snapshot from a few minutes ago.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "During upstream outages, the app keeps serving the last good scores from durable storage instead of failing — combined with the new banner, courtside refreshing no longer feels broken.",
        ],
      },
    ],
  },
  {
    id: "2026-04-26",
    date: "April 26, 2026",
    title: "Pick Your View",
    screenshotScenes: ["comparison-table"],
    sections: [
      {
        heading: "New",
        items: [
          "Pre-match view is now selectable next to Live and Coaching, even after the match has started. Useful when early squads have finished but yours hasn't shot yet — afternoon squads, day-2 squads, or competitors when RO squads shot the day before.",
          "Stages view: a new SSI-style toggle on the comparison table renders one mini scorecard per stage, with selected competitors as rows and Time, HF, Pts, A, C, D, NS, M, P as columns — quick to read right after a stage is scored.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Smarter auto-view: pre-match stays the default until scoring is meaningfully underway. Coaching kicks in once results are published, scoring hits 95%, or three days have passed since the match ended. Multi-day matches whose end date isn't published get a 3-day grace window so late squads still see pre-match info.",
          "Live freshness: cache TTL for active matches is now ~30 s (was 5 min), so fresh scorecards appear within seconds of the upstream update — no more waiting after a stage finishes.",
        ],
      },
    ],
  },
  {
    id: "2026-03-17",
    date: "March 17, 2026",
    title: "Upcoming Match Actions",
    screenshotScenes: ["shooter-dashboard"],
    sections: [
      {
        heading: "New",
        items: [
          "Upcoming match cards on the shooter dashboard now show exactly what you need to do: register, pick your squad, or just show up. Status is checked against live match data — not guessed.",
          "Countdown badge (Today / Tomorrow / 5d) on each upcoming match card for quick orientation.",
          "Direct SSI link on actionable cards — tap to register or pick your squad on Shoot'n Score It without leaving the dashboard.",
          "Discord: /remind upcoming — a personal action checklist for your next 8 days of matches (configurable). Use /remind upcoming daily for a daily DM digest. Requires /link.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Dashboard reordered for courtside use: upcoming matches are now at the top (sorted by urgency), performance trend charts are collapsed by default.",
        ],
      },
    ],
  },
  {
    id: "2026-03-12",
    date: "March 12, 2026",
    title: "Pre-match View",
    screenshotScenes: ["comparison-table"],
    sections: [
      {
        heading: "New",
        items: [
          "Pre-match view: open any upcoming match to see a dedicated preparation screen instead of the (empty) comparison view.",
          "Stage rotation: select your squad to see exactly which stage you shoot each round, based on the standard IPSC round-robin schedule. Your squad is auto-detected if you've set your identity or selected a competitor.",
          "Stage details: each row shows course length, round count, target breakdown (paper / steel), and constraint badges for unloaded start, strong hand, weak hand, and moving target stages.",
          "Registered field: all competitors grouped by division. Tracked shooters and your identity are highlighted and their divisions expand automatically.",
          "Match day weather forecast: when the venue has coordinates, shows sky conditions, temperature range, wind speed and direction, and precipitation for the match day.",
          "AI pre-match brief: if AI coaching is configured and you have a tracked identity, a personalised 2–3 sentence preparation tip is generated based on the match's stage breakdown and your historical performance patterns.",
        ],
      },
    ],
  },
  {
    id: "2026-03-11",
    date: "March 11, 2026",
    title: "Conditions Overlay, Penalty Rate & Consistency Trends",
    screenshotScenes: ["conditions-overlay", "comparison-table", "shooter-dashboard"],
    sections: [
      {
        heading: "New",
        items: [
          "Conditions overlay: tap the cloud icon above the comparison table (coaching mode only) to reveal per-cell weather, time-of-day, and wind icons for each stage. Competitors in different squads shoot the same stage at different times — this makes that visible at a glance.",
          "Weather icon shows sky conditions (clear, overcast, rain, snow, fog, thunderstorm). Time icon shows whether the stage was shot at sunrise, daytime, sunset, or night. Wind icon appears when wind is ≥ 3 m/s — the rounded speed in m/s sits next to the icon so the intensity is readable without relying on color alone.",
          "Tap or hover any cell's icons to see the exact UTC time, weather label, temperature, wind speed, compass direction, and gusts.",
          "AI coaching tips now include weather context: temperature, wind, precipitation, humidity, and elevation are woven into the coaching analysis when venue coordinates are available.",
          "Penalty rate trend: tracks misses, no-shoots, and procedurals as a percentage of total rounds fired across matches. Lower is better — a rising trend signals something worth fixing in training.",
          "Consistency index trend: measures how evenly you perform stage-to-stage within each match. Computed from the coefficient of variation of per-stage hit factors, scaled to 0–100 (higher is better). A drop flags a single blown stage rather than a bad overall match.",
        ],
      },
    ],
  },
  {
    id: "2026-03-10",
    date: "March 10, 2026",
    title: "Device Sync",
    screenshotScenes: ["tracked-shooters-sheet"],
    sections: [
      {
        heading: "New",
        items: [
          "Sync between devices: transfer your identity, tracked shooters, recent matches, and saved competitor selections from one device to another with a one-time 6-character code.",
          "Generate a sync code from the \"My shooters\" sheet — scan the QR code or type the code on your other device to import everything instantly.",
          "Direct sync link in the footer for quick access from any page.",
        ],
      },
    ],
  },
  {
    id: "2026-03-05",
    date: "March 5, 2026",
    title: "Find Shooter & My Shooters",
    screenshotScenes: ["tracked-shooters-sheet", "shooter-dashboard"],
    sections: [
      {
        heading: "New",
        items: [
          "Find shooter by name: search for any competitor directly from the \"My shooters\" sheet — no need to open a match first.",
          "Track from search: tap the star on any search result to add them to your tracked competitors list.",
          "Set your identity from search: tap the user-check icon on your own name to claim it as \"this is me\".",
          "Dashboard shortcut: tap the arrow icon on any search result or tracked competitor to jump straight to their career dashboard.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "\"My shooters\" is now always visible — on the homepage below the match search, and in the footer on every page. No longer hidden behind setting an identity first.",
        ],
      },
    ],
  },
  {
    id: "2026-03-04b",
    date: "March 4, 2026",
    title: "Division-Aware Dashboard Charts",
    screenshotScenes: ["shooter-dashboard"],
    sections: [
      {
        heading: "New",
        items: [
          "Division filter on the shooter dashboard: filter your performance trends and aggregate stats by division. Defaults to your most frequently shot division when you compete across multiple.",
          "Division-colored dots: when viewing all divisions, chart dots are colored by division and sized by field strength so you can spot division switches at a glance.",
          "A-zone % trend chart: a new third chart showing your accuracy over time — the most stable cross-division metric for tracking pure accuracy improvement.",
          "3-match moving average: dashed trend lines on all charts smooth out noise and make long-term progress easier to see.",
          "Enhanced chart tooltips: now show match name, division with color bullet, level badge, and number of competitors in your division.",
        ],
      },
    ],
  },
  {
    id: "2026-03-04",
    date: "March 4, 2026",
    title: "Match Backfill & Discovery",
    screenshotScenes: ["comparison-table", "shooter-dashboard", "whats-new-dialog"],
    sections: [
      {
        heading: "New",
        items: [
          "Find past matches: tap the scan button on your shooter dashboard to search through matches that have been viewed on this app. The more people use the app, the more matches you'll discover.",
          "Add match by URL: paste any ShootNScoreIt match URL to manually add a match that wasn't found by the scan.",
          "Competitor names in the comparison table now link directly to their shooter dashboard.",
        ],
      },
    ],
  },
  {
    id: "2026-03-03b",
    date: "March 3, 2026",
    title: "Shooter Dashboard & My Stats",
    screenshotScenes: ["shooter-dashboard", "whats-new-dialog"],
    sections: [
      {
        heading: "New",
        items: [
          "Shooter dashboard — your personal cross-match stats page. Open /me or tap \"My Stats\" in the footer after claiming your identity.",
          "Match history: every match you've competed in (that has been viewed on this app) appears in a scrollable list. Tap any entry to jump straight to that match with yourself pre-selected.",
          "Performance trends: hit factor and match % charted over time so you can see whether your results are improving, stable, or declining across competitions.",
          "Aggregate stats: overall average HF, mean match %, accuracy breakdown (A/C/D/miss %), consistency coefficient of variation, and a HF trend indicator.",
          "\"My Stats\" link in the footer — appears automatically once you've set your identity.",
        ],
      },
    ],
  },
  {
    id: "2026-03-03",
    date: "March 3, 2026",
    title: "Identity, Tracked Shooters, Stage Sort & Degradation Analysis",
    screenshotScenes: [
      "comparison-table",
      "degradation-chart",
      "hf-level-bars",
      "competitor-identity",
      "tracked-shooters-sheet",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "\"This is me\" — claim your shooter identity by tapping the person icon next to your name in the competitor picker. Your identity is auto-selected whenever you open a match you competed in.",
          "Tracked competitors — tap the star icon next to any competitor to follow them across matches. All tracked shooters are auto-selected when you visit their matches, so you never have to search again. Manage your list from the picker footer or your name in the footer.",
          "Per-column sort in the comparison table: click any competitor's column header to reorder stages by the sequence they actually shot them — useful for spotting fatigue or consistency patterns across a competition day. Click the Stage column header to return to stage-number order.",
          "Stage degradation chart (Coaching mode): see whether shooting early or late on a stage correlated with higher or lower performance across the full field. The Spearman r badge shows the sample size (n) and whether the trend is statistically significant at 95% confidence — non-significant trends appear in muted text so you can tell signal from noise.",
          "Field accuracy rate on stage tooltips: hover the HF Level bars to see the median accuracy (% of max points) the field scored on that stage — distinguishes hard-shooting stages from long-but-accurate ones.",
          "Stage separator indicator: a ↕ icon flags stages that spread the field apart the most, with a tooltip showing the competitor count used for the calculation.",
          "Division distribution chart tooltips now show the number of competitors behind each stage's Q1–Q3 band, plus an n range in the legend.",
          "Style fingerprint archetype labels hedge to 'tends toward X style' when the field is under 25 competitors, with field size shown in the tooltip.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Stage difficulty relabelled to HF Level with neutral labels (Very high / High / Medium / Low / Very low). A low HF can reflect long running distances or high round count, not just hard shots.",
          "What's New now shows all releases you missed since your last visit — no more skipping updates after a busy week.",
          "Consistency Index badge dims below 6 stages (raised from 4) to flag when the CV is based on too few stages to be reliable.",
          "Archetype, course-length, and constraint breakdown tables highlight stage counts of 1–2 in amber to flag averages based on very few samples.",
        ],
      },
    ],
  },
  {
    id: "2026-03-01",
    date: "March 1, 2026",
    title: "Live/Coaching Mode & Stage Analytics",
    screenshotScenes: [
      "archetype-chart",
      "style-fingerprint",
      "comparison-table",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "Live mode & Coaching mode: the app auto-detects whether a match is active or complete. Live mode keeps scores fresh while you shoot; Coaching mode unlocks the full analysis suite after the match.",
          "You can override the auto-detected mode with the toggle above the competitor picker. Tap the active button to reset to auto.",
          "Stage archetype badges: stages are classified as Speed, Precision, or Mixed based on target composition — look for the icon next to the difficulty bars.",
          "Archetype performance breakdown: compare your group's average stage % across Speed, Precision, and Mixed stages to spot strengths and weaknesses.",
          "Division position chart: see where each competitor sits within their division on every stage. The shaded band shows the middle 50% of the division, with median and minimum lines for context.",
          "If selected competitors span multiple divisions, use the division selector to switch between them.",
          "Constraint badges on stage headers: strong hand, weak hand, and moving target stages are flagged with coloured icons.",
          "Course length & constraint breakdowns: see how performance varies by Short / Medium / Long courses, and between constrained (e.g. strong hand only) vs standard stages.",
        ],
      },
    ],
  },
  {
    id: "2026-02-28",
    date: "February 28, 2026",
    title: "AI Coach & Roast",
    screenshotScenes: [
      "comparison-table",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "AI coaching tips: get a personalised, professional IPSC coaching insight for any competitor in a completed match — based on accuracy, speed, consistency, penalties, and per-stage performance.",
          "Roast mode: tap \"Ask AI\" in the AI Coach row at the bottom of the comparison table and switch to the Roast tab for a friendly, humorous take on the results.",
        ],
      },
    ],
  },
  {
    id: "2026-02-28b",
    date: "February 28, 2026",
    title: "Stage Simulator: Multi-Stage & Full-Field Rank",
    screenshotScenes: [
      "comparison-table",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "Adjust multiple stages independently — the match avg and group rank rows show the cumulative impact across all modified stages.",
          "D-hit upgrades: convert D-hits to A or C-hits and see the immediate point impact.",
          "Procedural penalty removal: dial out procedural penalties to see how clean execution would have changed your result.",
          "Division rank and overall rank (vs the full field) now appear after a short delay, computed server-side against all match competitors.",
        ],
      },
      {
        heading: "Improved",
        items: [
          "Stage adjustments are saved in your browser and restored when you refresh the page.",
          "Modified stages are marked [✓] in the stage selector; a counter shows how many stages have adjustments.",
          "Separate reset buttons for the current stage or all stages.",
        ],
      },
    ],
  },
  {
    id: "2026-02-28",
    date: "February 28, 2026",
    title: "Stage Simulator",
    screenshotScenes: [
      "comparison-table",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "Stage Simulator: adjust your time or hit outcomes on any stage and instantly see the impact on hit factor, stage %, match average, and group rank.",
          "Available after 80% of scorecards are submitted. Find it below the Coaching analysis section on any match page.",
          "Convert misses or no-shoots to A or C hits, upgrade C-hits to A-hits, or simulate a faster time — mix and match any combination.",
          "Results panel shows stage rank and match rank among selected competitors, updating instantly.",
        ],
      },
    ],
  },
  {
    id: "2026-02-27b",
    date: "February 27, 2026",
    title: "Benchmark Picker",
    screenshotScenes: [
      "comparison-table",
      "comparison-table-mobile",
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "Benchmark picker: tap the Benchmark button to instantly add the top 1–3 ranked competitors in any division to the comparison view.",
        ],
      },
    ],
  },
  {
    id: "2026-02-27",
    date: "February 27, 2026",
    title: "Event Filters & More",
    screenshotScenes: [
      "whats-new-dialog",
    ],
    sections: [
      {
        heading: "New",
        items: [
          "Event filter selections (country, level) are now saved in your browser and restored when you return.",
          "Filters default to your region automatically, based on your timezone.",
          "Popular matches list has a Show more / Show less toggle.",
        ],
      },
    ],
  },
];
