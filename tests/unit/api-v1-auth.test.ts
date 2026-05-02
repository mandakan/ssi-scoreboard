import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(k: string) => Promise<string | null>>(),
  set: vi.fn<(k: string, v: string, ttl?: number) => Promise<void>>(),
}));

vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

const ORIGINAL_TOKENS = process.env.EXTERNAL_API_TOKENS;
const ORIGINAL_LIMIT = process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN;

describe("api-v1 auth + rate limit", () => {
  beforeEach(() => {
    cacheMock.get.mockReset();
    cacheMock.set.mockReset();
    cacheMock.get.mockResolvedValue(null);
    cacheMock.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (ORIGINAL_TOKENS === undefined) delete process.env.EXTERNAL_API_TOKENS;
    else process.env.EXTERNAL_API_TOKENS = ORIGINAL_TOKENS;
    if (ORIGINAL_LIMIT === undefined) delete process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN;
    else process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN = ORIGINAL_LIMIT;
  });

  it("rejects when EXTERNAL_API_TOKENS is unset", async () => {
    delete process.env.EXTERNAL_API_TOKENS;
    const { authenticateV1Request } = await import("@/lib/api-v1");
    const res = authenticateV1Request(
      new Request("http://x/api/v1/events", { headers: { Authorization: "Bearer abc" } }),
    );
    expect(res).toBeInstanceOf(Response);
    if (!(res instanceof Response)) return;
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("rejects when Authorization header is missing", async () => {
    process.env.EXTERNAL_API_TOKENS = "abc,def";
    const { authenticateV1Request } = await import("@/lib/api-v1");
    const res = authenticateV1Request(new Request("http://x/api/v1/events"));
    expect(res).toBeInstanceOf(Response);
    if (!(res instanceof Response)) return;
    expect(res.status).toBe(401);
  });

  it("rejects when bearer token is not in the configured set", async () => {
    process.env.EXTERNAL_API_TOKENS = "abc,def";
    const { authenticateV1Request } = await import("@/lib/api-v1");
    const res = authenticateV1Request(
      new Request("http://x/api/v1/events", { headers: { Authorization: "Bearer wrong" } }),
    );
    expect(res).toBeInstanceOf(Response);
    if (!(res instanceof Response)) return;
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("accepts a valid bearer token", async () => {
    process.env.EXTERNAL_API_TOKENS = "abc,def";
    const { authenticateV1Request } = await import("@/lib/api-v1");
    const res = authenticateV1Request(
      new Request("http://x/api/v1/events", { headers: { Authorization: "Bearer def" } }),
    );
    expect(res).not.toBeInstanceOf(Response);
    if (res instanceof Response) return;
    expect(res.token).toBe("def");
  });

  it("trims whitespace and ignores empty entries in EXTERNAL_API_TOKENS", async () => {
    process.env.EXTERNAL_API_TOKENS = " a , , b ,";
    const { parseExternalApiTokens } = await import("@/lib/api-v1");
    const tokens = parseExternalApiTokens();
    expect([...tokens].sort()).toEqual(["a", "b"]);
  });

  it("allows requests under the limit and returns 429 with Retry-After when over", async () => {
    process.env.EXTERNAL_API_TOKENS = "abc";
    process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN = "3";
    const { gateV1Request } = await import("@/lib/api-v1");

    // Three calls under the limit -- cache returns the running count.
    cacheMock.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("2")
      // Fourth call -- count is 3, equal to the limit -> rate-limited.
      .mockResolvedValueOnce("3");

    const make = () =>
      new Request("http://x/api/v1/events", { headers: { Authorization: "Bearer abc" } });

    const r1 = await gateV1Request(make());
    const r2 = await gateV1Request(make());
    const r3 = await gateV1Request(make());
    const r4 = await gateV1Request(make());

    expect(r1).not.toBeInstanceOf(Response);
    expect(r2).not.toBeInstanceOf(Response);
    expect(r3).not.toBeInstanceOf(Response);
    expect(r4).toBeInstanceOf(Response);
    if (!(r4 instanceof Response)) return;
    expect(r4.status).toBe(429);
    expect(r4.headers.get("Retry-After")).toMatch(/^[1-9]\d*$/);
    const body = (await r4.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("fails open if the cache adapter throws", async () => {
    process.env.EXTERNAL_API_TOKENS = "abc";
    cacheMock.get.mockRejectedValue(new Error("redis down"));
    const { checkV1RateLimit } = await import("@/lib/api-v1");
    const result = await checkV1RateLimit("abc");
    expect(result).toEqual({ allowed: true });
  });

  it("uses a token-hash cache key (not the raw token)", async () => {
    process.env.EXTERNAL_API_TOKENS = "supersecret";
    const { checkV1RateLimit } = await import("@/lib/api-v1");
    await checkV1RateLimit("supersecret");
    const usedKey = cacheMock.set.mock.calls[0]?.[0];
    expect(usedKey).toBeTruthy();
    expect(usedKey).not.toContain("supersecret");
    expect(usedKey).toMatch(/^rl:v1:[0-9a-f]+:\d+$/);
  });
});

describe("api-v1 mapInnerToV1", () => {
  it("passes through 2xx responses unchanged but strips Server-Timing", async () => {
    const { mapInnerToV1 } = await import("@/lib/api-v1");
    const inner = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Server-Timing": "graphql;dur=10" },
    });
    const mapped = await mapInnerToV1(inner);
    expect(mapped.status).toBe(200);
    expect(mapped.headers.get("Server-Timing")).toBeNull();
    expect(await mapped.json()).toEqual({ ok: true });
  });

  it("maps 404 to not_found", async () => {
    const { mapInnerToV1 } = await import("@/lib/api-v1");
    const inner = new Response(JSON.stringify({ error: "Match not found" }), { status: 404 });
    const mapped = await mapInnerToV1(inner, { notFoundMessage: "Match not found" });
    expect(mapped.status).toBe(404);
    expect(await mapped.json()).toEqual({
      error: { code: "not_found", message: "Match not found" },
    });
  });

  it("maps 400 to bad_request", async () => {
    const { mapInnerToV1 } = await import("@/lib/api-v1");
    const inner = new Response(JSON.stringify({ error: "Invalid limit" }), { status: 400 });
    const mapped = await mapInnerToV1(inner);
    const body = (await mapped.json()) as { error: { code: string; message: string } };
    expect(mapped.status).toBe(400);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toBe("Invalid limit");
  });

  it("maps 5xx to upstream_failed with status 502", async () => {
    const { mapInnerToV1 } = await import("@/lib/api-v1");
    const inner = new Response(JSON.stringify({ error: "Boom" }), { status: 502 });
    const mapped = await mapInnerToV1(inner);
    const body = (await mapped.json()) as { error: { code: string } };
    expect(mapped.status).toBe(502);
    expect(body.error.code).toBe("upstream_failed");
  });

  it("maps 410 (GDPR suppression) to not_found preserving the 410 status", async () => {
    const { mapInnerToV1 } = await import("@/lib/api-v1");
    const inner = new Response(JSON.stringify({ error: "removed" }), { status: 410 });
    const mapped = await mapInnerToV1(inner);
    const body = (await mapped.json()) as { error: { code: string } };
    expect(mapped.status).toBe(410);
    expect(body.error.code).toBe("not_found");
  });
});
