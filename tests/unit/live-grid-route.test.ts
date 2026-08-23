import { describe, expect, it, vi } from "vitest";

// The validation paths below return before any cache or upstream access, but
// importing the route pulls in the cache/graphql modules -- stub them so the
// test stays a pure unit test of request validation.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
}));
vi.mock("@/lib/telemetry-context", () => ({ maybeTagAsMcp: vi.fn() }));

import { GET } from "@/app/api/live-grid/route";

async function call(qs: string) {
  const res = await GET(new Request(`http://localhost/api/live-grid?${qs}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/live-grid validation", () => {
  it("400s without ct", async () => {
    expect((await call("id=1&competitor_ids=1")).status).toBe(400);
  });

  it("400s without id", async () => {
    expect((await call("ct=22&competitor_ids=1")).status).toBe(400);
  });

  it("400s without competitor_ids", async () => {
    expect((await call("ct=22&id=1")).status).toBe(400);
  });

  it("400s on a non-numeric ct", async () => {
    expect((await call("ct=abc&id=1&competitor_ids=1")).status).toBe(400);
  });

  it("400s when competitor_ids parses to nothing", async () => {
    expect((await call("ct=22&id=1&competitor_ids=x,y")).status).toBe(400);
  });

  it("400s past MAX_LIVE_GRID_ROWS", async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1).join(",");
    const res = await call(`ct=22&id=1&competitor_ids=${ids}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/20/);
  });

  it("accepts exactly MAX_LIVE_GRID_ROWS ids without a validation error", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1).join(",");
    const res = await call(`ct=22&id=1&competitor_ids=${ids}`);
    // Passes validation; whatever happens next is a cache/upstream concern.
    expect(res.status).not.toBe(400);
  });
});
