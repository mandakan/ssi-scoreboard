// Query key factories shared between client hooks (lib/queries.ts) and
// server-side prefetch calls (e.g. app/match/.../page.tsx).
// This file has NO "use client" directive so it can be imported by both.

import type { CompareMode } from "@/lib/types";

export const matchQueryKey = (ct: string, id: string) =>
  ["match", ct, id] as const;

export const compareQueryKey = (
  ct: string,
  id: string,
  competitorIds: number[],
  mode: CompareMode = "coaching",
) => ["compare", ct, id, competitorIds, mode] as const;

export const coachingAvailabilityKey = () =>
  ["coaching-availability"] as const;

export const coachingTipQueryKey = (
  ct: string,
  id: string,
  competitorId: number,
  mode: "coach" | "roast" = "coach",
) => ["coaching-tip", ct, id, competitorId, mode] as const;
