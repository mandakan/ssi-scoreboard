import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal ioredis stand-in: `status` is what the adapter must consult, and
// every command hangs forever -- exactly what a queued command does while the
// real client waits for its next reconnect attempt. If the adapter delegates
// when it should fail fast, the test times out instead of resolving.
const state = vi.hoisted(() => ({ status: "ready" as string }));
const hang = () => new Promise<never>(() => {});

vi.mock("ioredis", () => {
  class FakeRedis {
    get status() {
      return state.status;
    }
    on() {
      return this;
    }
    get = vi.fn(() => (state.status === "ready" ? Promise.resolve("v") : hang()));
    set = vi.fn(() => (state.status === "ready" ? Promise.resolve("OK") : hang()));
    del = vi.fn(() => (state.status === "ready" ? Promise.resolve(1) : hang()));
  }
  return { default: FakeRedis };
});

async function loadAdapter() {
  vi.resetModules();
  return (await import("@/lib/cache-impl")).default;
}

describe("cache-node adapter when Redis is unreachable", () => {
  beforeEach(() => {
    state.status = "ready";
  });

  it("delegates normally while connected", async () => {
    const adapter = await loadAdapter();
    await expect(adapter.get("k")).resolves.toBe("v");
  });

  it("rejects immediately while ioredis is in reconnect back-off", async () => {
    state.status = "reconnecting";
    const adapter = await loadAdapter();
    await expect(adapter.get("k")).rejects.toThrow(/unavailable/i);
  });

  it("rejects writes immediately too, so refresh paths do not stall", async () => {
    state.status = "reconnecting";
    const adapter = await loadAdapter();
    await expect(adapter.set("k", "v", 10)).rejects.toThrow(/unavailable/i);
    await expect(adapter.del("k")).rejects.toThrow(/unavailable/i);
  });

  it("still lets the lazy first connection proceed (status 'wait')", async () => {
    state.status = "wait";
    const adapter = await loadAdapter();
    // In this state the real client queues the command and connects; the
    // fake mimics that by hanging, so we only assert it was not rejected
    // within a short window.
    const outcome = await Promise.race([
      adapter.get("k").then(() => "resolved", () => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("pending"), 50)),
    ]);
    expect(outcome).toBe("pending");
  });
});
