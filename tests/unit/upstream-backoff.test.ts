import { describe, it, expect, vi, beforeEach } from "vitest";
import { isApiKeyRejection } from "@/lib/graphql";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(key: string, val: string, ttl: number | null) => Promise<void>>(),
  del: vi.fn<(key: string) => Promise<void>>(),
  expire: vi.fn(),
  persist: vi.fn(),
  setIfAbsent: vi.fn(),
}));
vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

import {
  assertNotInBackoff,
  recordUpstreamFailure,
  recordUpstreamSuccess,
  computeBackoffDelaySeconds,
  BACKOFF_KEY,
  UPSTREAM_BACKOFF_ERROR,
} from "@/lib/upstream-backoff";

beforeEach(() => {
  Object.values(cacheMock).forEach((fn) => fn.mockReset());
  cacheMock.set.mockResolvedValue(undefined);
  cacheMock.del.mockResolvedValue(undefined);
});

describe("computeBackoffDelaySeconds", () => {
  it("grows exponentially from 5s and caps at 600s", () => {
    expect(computeBackoffDelaySeconds(1, null)).toBe(10);
    expect(computeBackoffDelaySeconds(2, null)).toBe(20);
    expect(computeBackoffDelaySeconds(3, null)).toBe(40);
    expect(computeBackoffDelaySeconds(10, null)).toBe(600);
  });

  it("honors a larger Retry-After", () => {
    expect(computeBackoffDelaySeconds(1, "120")).toBe(120);
  });

  it("ignores a smaller or invalid Retry-After", () => {
    expect(computeBackoffDelaySeconds(3, "5")).toBe(40);
    expect(computeBackoffDelaySeconds(1, "garbage")).toBe(10);
  });
});

describe("assertNotInBackoff", () => {
  it("passes when no backoff state exists", async () => {
    cacheMock.get.mockResolvedValue(null);
    await expect(assertNotInBackoff()).resolves.toBeUndefined();
  });

  it("throws while the hold-off window is active", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({ level: 2, untilIso: new Date(Date.now() + 60_000).toISOString() }),
    );
    await expect(assertNotInBackoff()).rejects.toThrow(UPSTREAM_BACKOFF_ERROR);
  });

  it("passes once the hold-off window has elapsed (half-open)", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({ level: 2, untilIso: new Date(Date.now() - 1_000).toISOString() }),
    );
    await expect(assertNotInBackoff()).resolves.toBeUndefined();
  });

  it("fails open when the cache is down", async () => {
    cacheMock.get.mockRejectedValue(new Error("redis down"));
    await expect(assertNotInBackoff()).resolves.toBeUndefined();
  });
});

describe("recordUpstreamFailure", () => {
  it("starts at level 1 with a 10s hold-off", async () => {
    cacheMock.get.mockResolvedValue(null);
    await recordUpstreamFailure(null);
    const [key, val] = cacheMock.set.mock.calls[0];
    expect(key).toBe(BACKOFF_KEY);
    const state = JSON.parse(val as string) as { level: number; untilIso: string };
    expect(state.level).toBe(1);
    const holdMs = new Date(state.untilIso).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(8_000);
    expect(holdMs).toBeLessThan(12_000);
  });

  it("escalates the level on repeated failures", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({ level: 3, untilIso: new Date(Date.now() - 1000).toISOString() }),
    );
    await recordUpstreamFailure(null);
    const state = JSON.parse(cacheMock.set.mock.calls[0][1] as string) as { level: number };
    expect(state.level).toBe(4);
  });
});

describe("recordUpstreamSuccess (half-open reset)", () => {
  it("clears the state only after the hold-off has elapsed", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({ level: 2, untilIso: new Date(Date.now() - 1000).toISOString() }),
    );
    await recordUpstreamSuccess();
    expect(cacheMock.del).toHaveBeenCalledWith(BACKOFF_KEY);
  });

  it("does NOT reset while a hold-off is still active (avoids flapping)", async () => {
    cacheMock.get.mockResolvedValue(
      JSON.stringify({ level: 2, untilIso: new Date(Date.now() + 60_000).toISOString() }),
    );
    await recordUpstreamSuccess();
    expect(cacheMock.del).not.toHaveBeenCalled();
  });

  it("is a no-op with no backoff state", async () => {
    cacheMock.get.mockResolvedValue(null);
    await recordUpstreamSuccess();
    expect(cacheMock.del).not.toHaveBeenCalled();
  });
});

// ─── API-key rejection is a circuit-breaker condition (2026-08-22) ──────────
// SSI enables our key on weekdays only, so on weekends every call comes back
// as HTTP 200 with an "Invalid API Key!" GraphQL error. That bypasses the
// 429/5xx branch, so nothing tripped the backoff and prod sent ~800 pointless
// requests in a day. The predicate below is what now opens the gate.

describe("isApiKeyRejection", () => {
  it("matches SSI's key-rejection message", () => {
    expect(isApiKeyRejection("Invalid API Key!")).toBe(true);
    expect(isApiKeyRejection("2026-08-20..2026-08-27: Invalid API Key!")).toBe(true);
    expect(isApiKeyRejection("invalid api key")).toBe(true);
  });

  it("does NOT match the transient JWT messages", () => {
    // These are retried successfully by executeQuery's force-refresh path;
    // tripping the shared backoff on them would take the whole fleet down
    // for a token refresh.
    expect(isApiKeyRejection("Signature has expired")).toBe(false);
    expect(isApiKeyRejection("User must be authenticated")).toBe(false);
  });

  it("does NOT match unrelated upstream errors", () => {
    expect(isApiKeyRejection("Not allowed to view event")).toBe(false);
    expect(isApiKeyRejection("Cannot resolve keyword 'ipscscorecard_set'")).toBe(false);
  });
});
