import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { MatchResponse } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/hooks/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/lib/hooks/use-my-identity", () => ({ useMyIdentity: () => ({ identity: null }) }));
vi.mock("@/lib/hooks/use-tracked-shooters", () => ({
  useTrackedShooters: () => ({ trackedIds: [1] }),
}));
vi.mock("@/lib/live-grid-rows", () => ({ resolveGridRows: () => [1] }));
vi.mock("@/components/tracked-shooters-sheet", () => ({ TrackedShootersSheet: () => null }));

const gridProps: Array<{ live?: boolean }> = [];
vi.mock("@/components/live-grid", () => ({
  LiveGrid: (p: { live?: boolean }) => {
    gridProps.push(p);
    return null;
  },
}));

const MATCH = {
  name: "M",
  date: new Date().toISOString(),
  ends: null,
  scoring_pct: 30,
  results_status: "stg",
  match_status: "on",
  is_live_scores_accessible: true,
  ssi_url: null,
  cacheInfo: { cachedAt: null },
  stages: [],
  competitors: [{ id: 1, shooterId: 1, name: "A", competitor_number: "1", division: null, squad_id: null }],
  squads: [],
} as unknown as MatchResponse;

let stale: "refresh-failed" | "gone" | null = null;
vi.mock("@/components/match-gate", () => ({
  useMatch: () => ({ ct: "22", id: "1", match: MATCH, isFetching: false, stale }),
}));

import GridPageClient from "@/app/match/[ct]/[id]/grid-page-client";

describe("grid tab polling while match data is stale", () => {
  it("passes live=false while stale and live=true after recovery", () => {
    stale = "refresh-failed";
    gridProps.length = 0;
    const { rerender } = render(<GridPageClient />);
    expect(gridProps.at(-1)?.live).toBe(false);
    stale = null;
    rerender(<GridPageClient />);
    expect(gridProps.at(-1)?.live).toBe(true);
  });
});
