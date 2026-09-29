// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const usageSpy = vi.fn();
vi.mock("@/lib/usage-telemetry", () => ({ usageTelemetry: (ev: unknown) => usageSpy(ev) }));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));

import { POST } from "@/app/api/telemetry/ui/route";

const post = (body: string) =>
  POST(new Request("http://localhost/api/telemetry/ui", {
    method: "POST",
    // sendBeacon with a string sends text/plain; the route must not care.
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body,
  }));

describe("POST /api/telemetry/ui", () => {
  beforeEach(() => {
    usageSpy.mockReset();
    rateLimit.mockReset().mockResolvedValue({ allowed: true });
  });

  it("forwards a valid event and returns 204", async () => {
    const ev = { op: "tab-view", ct: 22, tab: "analysis" };
    const res = await post(JSON.stringify(ev));
    expect(res.status).toBe(204);
    expect(usageSpy).toHaveBeenCalledWith(ev);
  });

  it("rate-limits under its own prefix", async () => {
    await post(JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" }));
    expect(rateLimit).toHaveBeenCalledWith(expect.any(Request), {
      prefix: "telemetry-ui", limit: 60, windowSeconds: 60,
    });
  });

  it("429s without logging when rate-limited", async () => {
    rateLimit.mockResolvedValue({ allowed: false, retryAfter: 7 });
    const res = await post(JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" }));
    expect(res.status).toBe(429);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["empty body", ""],
    ["non-JSON", "not json"],
    ["JSON array", "[]"],
    ["unknown op", JSON.stringify({ op: "nope", ct: 22 })],
    ["smuggled id", JSON.stringify({ op: "tab-view", ct: 22, tab: "grid", shooterId: 1 })],
  ])("400s without logging: %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("413s an oversized body without parsing or logging", async () => {
    const res = await post("x".repeat(2048));
    expect(res.status).toBe(413);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("413s on a declared Content-Length over the cap without reading the body", async () => {
    const text = vi.fn(async () => "");
    const req = {
      headers: new Headers({ "content-length": "5000" }),
      text,
    } as unknown as Request;
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(text).not.toHaveBeenCalled();
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("measures the cap in UTF-8 bytes, not characters", async () => {
    // 600 chars, 1200 bytes: under a character cap, over the byte cap.
    const res = await post("\u00e9".repeat(600));
    expect(res.status).toBe(413);
  });

  it("403s cross-site senders without logging", async () => {
    const res = await POST(new Request("http://localhost/api/telemetry/ui", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" }),
    }));
    expect(res.status).toBe(403);
    expect(usageSpy).not.toHaveBeenCalled();
  });

  it("accepts same-origin senders and senders without Sec-Fetch-Site", async () => {
    const body = JSON.stringify({ op: "tab-view", ct: 22, tab: "grid" });
    const sameOrigin = await POST(new Request("http://localhost/api/telemetry/ui", {
      method: "POST", headers: { "sec-fetch-site": "same-origin" }, body,
    }));
    expect(sameOrigin.status).toBe(204);
    expect((await post(body)).status).toBe(204);
  });
});
