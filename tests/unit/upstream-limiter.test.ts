import { describe, it, expect, afterEach } from "vitest";
import { withUpstreamSlot, upstreamLimiterStats } from "@/lib/upstream-limiter";

const ORIGINAL = process.env.UPSTREAM_MAX_CONCURRENCY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.UPSTREAM_MAX_CONCURRENCY;
  else process.env.UPSTREAM_MAX_CONCURRENCY = ORIGINAL;
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
