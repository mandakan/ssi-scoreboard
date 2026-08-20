import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";

const cacheMock = vi.hoisted(() => ({
  setIfAbsent: vi.fn<(key: string, val: string, ttl: number) => Promise<boolean>>(),
  del: vi.fn<(key: string) => Promise<void>>(),
}));
vi.mock("@/lib/cache-impl", () => ({ default: cacheMock }));

import { withUpstreamSlot, upstreamLimiterStats } from "@/lib/upstream-limiter";

const ORIGINAL = process.env.UPSTREAM_MAX_CONCURRENCY;

beforeEach(() => {
  cacheMock.setIfAbsent.mockReset().mockResolvedValue(true);
  cacheMock.del.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.UPSTREAM_MAX_CONCURRENCY;
  else process.env.UPSTREAM_MAX_CONCURRENCY = ORIGINAL;
  delete process.env.UPSTREAM_GLOBAL_WAIT_MS;
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withUpstreamSlot", () => {
  it("never runs more than the limit concurrently (default 2)", async () => {
    delete process.env.UPSTREAM_MAX_CONCURRENCY;
    let running = 0;
    let peak = 0;
    const task = () =>
      withUpstreamSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return null;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns the wrapped function's value and propagates rejections", async () => {
    await expect(withUpstreamSlot(async () => 42)).resolves.toBe(42);
    await expect(
      withUpstreamSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("releases the slot after a rejection so later tasks still run", async () => {
    await withUpstreamSlot(async () => {
      throw new Error("first");
    }).catch(() => {});
    await withUpstreamSlot(async () => {
      throw new Error("second");
    }).catch(() => {});
    await expect(withUpstreamSlot(async () => "ok")).resolves.toBe("ok");
    expect(upstreamLimiterStats().inFlight).toBe(0);
  });

  it("runs waiters in FIFO order", async () => {
    process.env.UPSTREAM_MAX_CONCURRENCY = "1";
    const order: number[] = [];
    const gate = deferred<void>();
    const first = withUpstreamSlot(async () => {
      await gate.promise;
      order.push(1);
    });
    const second = withUpstreamSlot(async () => {
      order.push(2);
    });
    const third = withUpstreamSlot(async () => {
      order.push(3);
    });
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("respects UPSTREAM_MAX_CONCURRENCY override", async () => {
    process.env.UPSTREAM_MAX_CONCURRENCY = "1";
    let running = 0;
    let peak = 0;
    const task = () =>
      withUpstreamSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });
});

describe("global slot leases (cross-isolate cap)", () => {
  it("claims a Redis slot and releases it after the call", async () => {
    await withUpstreamSlot(async () => "ok");
    expect(cacheMock.setIfAbsent).toHaveBeenCalledWith("upstream:slot:0", "1", 90);
    expect(cacheMock.del).toHaveBeenCalledWith("upstream:slot:0");
  });

  it("falls through to the next slot key when the first is taken", async () => {
    cacheMock.setIfAbsent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await withUpstreamSlot(async () => "ok");
    expect(cacheMock.setIfAbsent).toHaveBeenCalledWith("upstream:slot:1", "1", 90);
    expect(cacheMock.del).toHaveBeenCalledWith("upstream:slot:1");
  });

  it("fail-open: runs anyway when no slot frees within the wait budget", async () => {
    process.env.UPSTREAM_GLOBAL_WAIT_MS = "0";
    cacheMock.setIfAbsent.mockResolvedValue(false);
    await expect(withUpstreamSlot(async () => 7)).resolves.toBe(7);
    expect(cacheMock.del).not.toHaveBeenCalled();
  });

  it("fail-open: runs anyway when Redis errors", async () => {
    cacheMock.setIfAbsent.mockRejectedValue(new Error("redis down"));
    await expect(withUpstreamSlot(async () => 7)).resolves.toBe(7);
    expect(upstreamLimiterStats().inFlight).toBe(0);
  });

  it("releases the slot even when the wrapped call throws", async () => {
    await withUpstreamSlot(async () => {
      throw new Error("boom");
    }).catch(() => {});
    expect(cacheMock.del).toHaveBeenCalledWith("upstream:slot:0");
    expect(upstreamLimiterStats().inFlight).toBe(0);
  });
});

describe("global slot wait budget (hang regression, 2026-08-20)", () => {
  it("gives up quickly when no slot frees, so a fan-out cannot hang the request", async () => {
    // Shipped at 10s per call: an 18-stage fan-out paid it 18 times and the
    // Workers runtime cancelled the request. Budget must stay well under a
    // second by default.
    cacheMock.setIfAbsent.mockResolvedValue(false);
    const started = Date.now();
    await withUpstreamSlot(async () => "ok");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("honours UPSTREAM_GLOBAL_WAIT_MS=0 as claim-or-proceed", async () => {
    process.env.UPSTREAM_GLOBAL_WAIT_MS = "0";
    cacheMock.setIfAbsent.mockResolvedValue(false);
    const started = Date.now();
    await withUpstreamSlot(async () => "ok");
    expect(Date.now() - started).toBeLessThan(200);
  });
});
