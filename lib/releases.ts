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
export const LATEST_RELEASE_ID = "2026-02-27b";

export const RELEASES: Release[] = [
  {
    id: LATEST_RELEASE_ID,
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
