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
});
