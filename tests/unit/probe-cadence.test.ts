import { describe, it, expect, vi, beforeEach } from "vitest";

const cacheMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => Promise<string | null>>(),
  set: vi.fn<(key: string, val: string, ttl: number | null) => Promise<void>>(),
  del: vi.fn<(key: string) => Promise<void>>(),
  expire: vi.fn(),
  persist: vi.fn(),
  setIfAbsent: vi.fn(),
}));
vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

import { shouldProbeNow, recordProbeOutcome, probeCadenceKey } from "@/lib/probe-cadence";

const KEY = probeCadenceKey(22, "26547");

beforeEach(() => {
  Object.values(cacheMock).forEach((fn) => fn.mockReset());
  cacheMock.set.mockResolvedValue(undefined);
  cacheMock.del.mockResolvedValue(undefined);
});

function state(streak: number, lastBumpMsAgo: number, notBeforeMsFromNow: number | null) {
  return JSON.stringify({
    streak,
    lastBumpAtIso: new Date(Date.now() - lastBumpMsAgo).toISOString(),
    notBeforeIso: notBeforeMsFromNow === null ? null : new Date(Date.now() + notBeforeMsFromNow).toISOString(),
  });
}

describe("shouldProbeNow", () => {
  it("probes when no idle state exists", async () => {
    cacheMock.get.mockResolvedValue(null);
    expect(await shouldProbeNow(22, "26547")).toBe(true);
  });

  it("holds off while notBefore is in the future", async () => {
    cacheMock.get.mockResolvedValue(state(6, 60_000, 90_000));
    expect(await shouldProbeNow(22, "26547")).toBe(false);
  });

  it("probes again once notBefore has passed", async () => {
    cacheMock.get.mockResolvedValue(state(6, 200_000, -1_000));
    expect(await shouldProbeNow(22, "26547")).toBe(true);
  });

  it("fails open when the cache is down", async () => {
    cacheMock.get.mockRejectedValue(new Error("down"));
    expect(await shouldProbeNow(22, "26547")).toBe(true);
  });
});

describe("recordProbeOutcome", () => {
  it("a change clears the idle state (snap back to base cadence)", async () => {
    await recordProbeOutcome(22, "26547", true);
    expect(cacheMock.del).toHaveBeenCalledWith(KEY);
  });

  it("quiet cycles below the threshold track the streak without a hold-off", async () => {
    cacheMock.get.mockResolvedValue(state(2, 60_000, null));
    await recordProbeOutcome(22, "26547", false);
    const written = JSON.parse(cacheMock.set.mock.calls[0][1] as string);
    expect(written.streak).toBe(3);
    expect(written.notBeforeIso).toBeNull();
  });

  it("the 5th quiet cycle starts a 120-150s (jittered) hold-off", async () => {
    cacheMock.get.mockResolvedValue(state(4, 60_000, null));
    await recordProbeOutcome(22, "26547", false);
    const written = JSON.parse(cacheMock.set.mock.calls[0][1] as string);
    expect(written.streak).toBe(5);
    const holdMs = new Date(written.notBeforeIso).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(115_000);
    expect(holdMs).toBeLessThan(155_000); // 120s + up to 25% jitter
  });

  it("the 8th quiet cycle deepens the hold-off to 300-375s (jittered)", async () => {
    cacheMock.get.mockResolvedValue(state(7, 200_000, null));
    await recordProbeOutcome(22, "26547", false);
    const written = JSON.parse(cacheMock.set.mock.calls[0][1] as string);
    expect(written.streak).toBe(8);
    const holdMs = new Date(written.notBeforeIso).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(295_000);
    expect(holdMs).toBeLessThan(380_000); // 300s + up to 25% jitter
  });

  it("does not double-count when both cache keys report within one cycle", async () => {
    cacheMock.get.mockResolvedValue(state(3, 5_000, null)); // bumped 5s ago
    await recordProbeOutcome(22, "26547", false);
    expect(cacheMock.set).not.toHaveBeenCalled();
  });
});
