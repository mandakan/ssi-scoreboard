// Query key factories shared between client hooks (lib/queries.ts) and
// server-side prefetch calls (e.g. app/match/.../page.tsx).
// This file has NO "use client" directive so it can be imported by both.

export const matchQueryKey = (ct: string, id: string) =>
  ["match", ct, id] as const;

export const compareQueryKey = (
  ct: string,
  id: string,
  competitorIds: number[],
) => ["compare", ct, id, competitorIds] as const;
