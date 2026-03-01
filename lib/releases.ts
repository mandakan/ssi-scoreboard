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
export const LATEST_RELEASE_ID = "2026-03-02";

export const RELEASES: Release[] = [
  {
    id: LATEST_RELEASE_ID,
    date: "March 2, 2026",
    title: "Division Position Chart",
    sections: [
      {
        heading: "New",
        items: [
          "Division position chart: see where each competitor sits within their division's HF distribution per stage — the shaded band shows the middle 50% (Q1–Q3) of the division, with the median and minimum as reference lines.",
          "Quickly spot stages where you outperformed or underperformed your division peers, regardless of the group you're comparing.",
          "When selected competitors span multiple divisions, use the division selector to switch between them.",
        ],
      },
    ],
  },
  {
    id: "2026-03-01",
    date: "March 1, 2026",
    title: "Stage Archetype Analysis",
    sections: [
      {
        heading: "New",
        items: [
          "Stage archetype badges: stages are now classified as Speed, Precision, or Mixed based on target composition — look for the icon next to the difficulty bars.",
          "Archetype performance breakdown in the Coaching analysis panel: compare average group % across stage types to spot strengths and weaknesses.",
        ],
      },
    ],
  },
  {
    id: "2026-02-28",
    date: "February 28, 2026",
    title: "AI Coach & Roast",
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
