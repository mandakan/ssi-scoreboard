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
export const LATEST_RELEASE_ID = "2026-02-27c";

export const RELEASES: Release[] = [
  {
    id: LATEST_RELEASE_ID,
    date: "February 27, 2026",
    title: "AI Coaching Tips",
    sections: [
      {
        heading: "New",
        items: [
          "AI coaching tips: get a 1–2 sentence coaching insight for any competitor in a completed match. Tap the sparkle icon in the comparison table header.",
          "Supports OpenAI-compatible APIs and Cloudflare Workers AI. Configure via AI_PROVIDER, AI_MODEL, and AI_API_KEY environment variables.",
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
