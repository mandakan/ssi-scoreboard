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
export const LATEST_RELEASE_ID = "2026-03-11";

export const RELEASES: Release[] = [
  {
    id: LATEST_RELEASE_ID,
    date: "March 11, 2026",
    title: "Conditions Overlay, Penalty Rate & Consistency Trends",
    screenshotScenes: ["conditions-overlay", "comparison-table", "shooter-dashboard"],
    sections: [
      {
        heading: "New",
        items: [
          "Conditions overlay: tap the cloud icon above the comparison table (coaching mode only) to reveal per-cell weather and time-of-day icons for each stage. Competitors in different squads shoot the same stage at different times — this makes that visible at a glance.",
          "Tap or hover any icon pair to see the exact UTC time, weather conditions, temperature, and wind speed when that competitor shot that stage.",
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
