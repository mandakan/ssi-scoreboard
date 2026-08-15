import { describe, it, expect } from "vitest";
import { allSettledWithLimit } from "@/lib/concurrency";

describe("allSettledWithLimit", () => {
  it("resolves with results in input order", async () => {
    const results = await allSettledWithLimit(
      [async () => "a", async () => "b", async () => "c"],
      2,
    );
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("captures rejections without failing the batch", async () => {
    const results = await allSettledWithLimit(
      [
        async () => "ok",
        async () => {
          throw new Error("boom");
        },
      ],
      2,
    );
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    const task = () => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    await allSettledWithLimit(Array.from({ length: 12 }, task), 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // sanity: it does actually run in parallel
  });

  it("handles an empty task list", async () => {
    expect(await allSettledWithLimit([], 4)).toEqual([]);
  });

  it("keeps working when limit exceeds task count", async () => {
    const results = await allSettledWithLimit([async () => 1], 8);
    expect(results).toEqual([{ status: "fulfilled", value: 1 }]);
  });
});
