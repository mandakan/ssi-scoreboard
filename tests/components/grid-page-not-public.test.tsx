import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MatchResponse } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const linkProps: Array<Record<string, unknown>> = [];
vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown> & { children: React.ReactNode }) => {
    linkProps.push(props);
    return <a href={props.href as string} className={props.className as string}>{children}</a>;
  },
}));
vi.mock("@/lib/hooks/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/lib/hooks/use-my-identity", () => ({ useMyIdentity: () => ({ identity: null }) }));
vi.mock("@/lib/hooks/use-tracked-shooters", () => ({ useTrackedShooters: () => ({ trackedIds: [] }) }));
vi.mock("@/components/live-grid", () => ({ LiveGrid: () => null }));

const MATCH = {
  name: "M",
  date: new Date().toISOString(),
  ends: null,
  scoring_pct: 30,
  results_status: "stg",
  match_status: "on",
  is_live_scores_accessible: false,
  ssi_url: null,
  cacheInfo: { cachedAt: null },
  stages: [],
  competitors: [],
  squads: [],
} as unknown as MatchResponse;
vi.mock("@/components/match-gate", () => ({
  useMatch: () => ({ ct: "22", id: "1", match: MATCH, isFetching: false }),
}));

import GridPageClient from "@/app/match/[ct]/[id]/grid-page-client";

describe("grid tab when live scores are not public", () => {
  it("links to the Info tab without prefetching, at a 44px target", () => {
    linkProps.length = 0;
    render(<GridPageClient />);
    const link = screen.getByRole("link", { name: /match info/i });
    expect(link).toHaveAttribute("href", "/match/22/1/info");
    expect(link.className).toContain("min-h-11");
    expect(linkProps).toHaveLength(1);
    expect(linkProps[0].prefetch).toBe(false);
  });
});
