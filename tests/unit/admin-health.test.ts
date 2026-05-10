import { describe, expect, it } from "vitest";

import { _internal } from "@/lib/admin-health";

const aggregate = _internal.aggregate;

const NOW = new Date("2026-05-10T15:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

describe("admin-health aggregate", () => {
  it("rolls up upstream calls into per-op p50/p95 and ok_pct", () => {
    const events = [
      { ts: minutesAgo(5), domain: "upstream", op: "graphql-request", operation: "GetMatch", outcome: "ok", ms: 100 },
      { ts: minutesAgo(10), domain: "upstream", op: "graphql-request", operation: "GetMatch", outcome: "ok", ms: 200 },
      { ts: minutesAgo(15), domain: "upstream", op: "graphql-request", operation: "GetMatch", outcome: "ok", ms: 300 },
      { ts: minutesAgo(20), domain: "upstream", op: "graphql-request", operation: "GetMatch", outcome: "ok", ms: 400 },
      { ts: minutesAgo(25), domain: "upstream", op: "graphql-request", operation: "GetMatch", outcome: "http-error", ms: 5000 },
    ];
    const out = aggregate(events, 1, NOW);
    expect(out.ssi_h1.calls).toBe(5);
    expect(out.ssi_h1.ok_pct).toBe(80);
    expect(out.ssi_h1.by_op).toHaveLength(1);
    expect(out.ssi_h1.by_op[0].operation).toBe("GetMatch");
    expect(out.ssi_h1.by_op[0].ok).toBe(4);
    expect(out.ssi_h1.by_op[0].err).toBe(1);
    expect(out.ssi_h1.by_op[0].p50_ms).toBeGreaterThanOrEqual(200);
    expect(out.ssi_h1.by_op[0].p95_ms).toBeGreaterThanOrEqual(400);
  });

  it("counts errors by site within the window", () => {
    const events = [
      { ts: minutesAgo(5), domain: "error", op: "boom", site: "foo" },
      { ts: minutesAgo(10), domain: "error", op: "boom", site: "foo" },
      { ts: minutesAgo(15), domain: "error", op: "boom", site: "bar" },
      { ts: minutesAgo(70), domain: "error", op: "boom", site: "stale" }, // outside h1, inside h24
    ];
    const out = aggregate(events, 1, NOW);
    expect(out.app_errors_h1.count).toBe(3);
    expect(out.app_errors_h1.by_site.find((r) => r.site === "foo")?.count).toBe(2);
    expect(out.app_errors_h24.count).toBe(4);
  });

  it("computes cache-hit rate from match-view events", () => {
    const events = [
      { ts: minutesAgo(5), domain: "usage", op: "match-view", cacheHit: true },
      { ts: minutesAgo(10), domain: "usage", op: "match-view", cacheHit: true },
      { ts: minutesAgo(15), domain: "usage", op: "match-view", cacheHit: false },
    ];
    const out = aggregate(events, 1, NOW);
    expect(out.cache_h1.samples).toBe(3);
    expect(out.cache_h1.hit_pct).toBeCloseTo(66.7, 0);
  });

  it("returns 0% with empty samples instead of NaN", () => {
    const out = aggregate([], 0, NOW);
    expect(out.cache_h1).toEqual({ hit_pct: 0, samples: 0 });
    expect(out.ssi_h1.calls).toBe(0);
    expect(out.ssi_h1.ok_pct).toBe(100); // vacuous truth — no failures yet
  });

  it("extracts top match IDs from cache decisions", () => {
    const events = [
      { ts: minutesAgo(5), domain: "cache", op: "match-ttl-decision", matchKey: 'gql:GetMatch:{"ct":22,"id":"100"}' },
      { ts: minutesAgo(10), domain: "cache", op: "match-ttl-decision", matchKey: 'gql:GetMatch:{"ct":22,"id":"100"}' },
      { ts: minutesAgo(15), domain: "cache", op: "match-ttl-decision", matchKey: 'gql:GetMatch:{"ct":22,"id":"200"}' },
    ];
    const out = aggregate(events, 1, NOW);
    expect(out.top_matches_h24).toEqual([
      { match_id: "100", count: 2 },
      { match_id: "200", count: 1 },
    ]);
  });

  it("sorts recent_errors newest first and limits to 10", () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      ts: minutesAgo(i + 1),
      domain: "error",
      op: "boom",
      site: `site-${i}`,
      errorMsg: `msg-${i}`,
    }));
    const out = aggregate(events, 1, NOW);
    expect(out.recent_errors).toHaveLength(10);
    expect(out.recent_errors[0].site).toBe("site-0"); // newest
    expect(out.recent_errors[9].site).toBe("site-9");
  });
});
