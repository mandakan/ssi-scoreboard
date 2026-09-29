// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageSpy = vi.fn();
vi.mock("@/lib/usage-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage-telemetry")>()),
  usageTelemetry: (ev: unknown) => usageSpy(ev),
}));
const rateLimit = vi.fn(async () => ({ allowed: true as const }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimit() }));
vi.mock("@/lib/telemetry-context", () => ({ maybeTagAsMcp: vi.fn() }));
vi.mock("@/lib/background-impl", () => ({ afterResponse: vi.fn() }));
vi.mock("@/lib/upstream-status", () => ({ isUpstreamDegraded: vi.fn(async () => false) }));
vi.mock("@/lib/upstream-pause", () => ({ isSsiUpstreamPaused: () => false }));
vi.mock("@/lib/cache-impl", () => ({
  default: { get: vi.fn(), persist: vi.fn(), expire: vi.fn() },
}));
vi.mock("@/lib/match-data-store", () => ({ persistToMatchStore: vi.fn() }));

const cachedExecuteQuery = vi.fn();
vi.mock("@/lib/graphql", () => ({
  cachedExecuteQuery: (...a: unknown[]) => cachedExecuteQuery(...a),
  gqlCacheKey: () => "k",
  MATCH_QUERY: "q",
  refreshCachedMatchQuery: vi.fn(),
}));
vi.mock("@/lib/scorecards-archive", () => ({ getMatchScorecards: vi.fn() }));

import { GET } from "@/app/api/live-grid/route";

// Active match, live scores hidden -> the route returns early with
// scorecardsRestricted, which is still a served grid.
const RESTRICTED_MATCH = {
  event: {
    starts: new Date().toISOString(),
    status: "on",
    results: "org",
    is_live_scores_accessible: false,
    stages: [{ id: "1", number: 1, name: "S1", max_points: 60,
               scoring_progress: { scored: 1, total: 10 } }],
    competitors_approved_w_wo_results_not_dnf: [
      { id: "100", first_name: "A", last_name: "B" },
    ],
    squads: [],
  },
};

const call = (qs: string) =>
  GET(new Request(`http://localhost/api/live-grid?${qs}`));

describe("live-grid-view telemetry", () => {
  beforeEach(() => {
    usageSpy.mockReset();
    rateLimit.mockResolvedValue({ allowed: true });
    cachedExecuteQuery.mockReset();
  });

  it("emits once for a served grid with bucketed rows", async () => {
    cachedExecuteQuery.mockResolvedValue({
      data: RESTRICTED_MATCH,
      cachedAt: new Date().toISOString(),
    });
    const res = await call("ct=22&id=1&competitor_ids=100,101,102");
    expect(res.status).toBe(200);
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy).toHaveBeenCalledWith({
      op: "live-grid-view", ct: 22, rowsBucket: "2-5", restricted: true,
    });
  });

  it("does not emit on a validation 400", async () => {
    expect((await call("ct=22&id=1")).status).toBe(400);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("does not emit on a 429", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 5 } as never);
    expect((await call("ct=22&id=1&competitor_ids=1")).status).toBe(429);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("does not emit on an upstream 502", async () => {
    cachedExecuteQuery.mockRejectedValue(new Error("boom"));
    expect((await call("ct=22&id=1&competitor_ids=1")).status).toBe(502);
    expect(usageSpy).not.toHaveBeenCalled();
  });
});
