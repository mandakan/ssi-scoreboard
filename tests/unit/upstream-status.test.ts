import { describe, it, expect, vi, beforeEach } from "vitest";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(key: string, val: string, ttl: number | null) => Promise<void>>(),
}));

vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

describe("upstream-status", () => {
  beforeEach(() => {
    cacheMock.get.mockReset();
    cacheMock.set.mockReset();
  });

  it("markUpstreamDegraded writes a 60s key with an ISO timestamp", async () => {
    cacheMock.set.mockResolvedValue(undefined);
    const { markUpstreamDegraded, UPSTREAM_DEGRADED_KEY } = await import(
      "@/lib/upstream-status"
    );

    await markUpstreamDegraded();

    expect(cacheMock.set).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = cacheMock.set.mock.calls[0];
    expect(key).toBe(UPSTREAM_DEGRADED_KEY);
    expect(ttl).toBe(60);
    expect(() => new Date(value).toISOString()).not.toThrow();
  });

  it("markUpstreamDegraded swallows cache errors", async () => {
    cacheMock.set.mockRejectedValue(new Error("cache down"));
    const { markUpstreamDegraded } = await import("@/lib/upstream-status");

    await expect(markUpstreamDegraded()).resolves.toBeUndefined();
  });

  it("isUpstreamDegraded returns true when the key exists", async () => {
    cacheMock.get.mockResolvedValue(new Date().toISOString());
    const { isUpstreamDegraded } = await import("@/lib/upstream-status");

    await expect(isUpstreamDegraded()).resolves.toBe(true);
  });

  it("isUpstreamDegraded returns false when the key is missing", async () => {
    cacheMock.get.mockResolvedValue(null);
    const { isUpstreamDegraded } = await import("@/lib/upstream-status");

    await expect(isUpstreamDegraded()).resolves.toBe(false);
  });

  it("isUpstreamDegraded returns false when the cache read throws", async () => {
    cacheMock.get.mockRejectedValue(new Error("cache down"));
    const { isUpstreamDegraded } = await import("@/lib/upstream-status");

    await expect(isUpstreamDegraded()).resolves.toBe(false);
  });
});
