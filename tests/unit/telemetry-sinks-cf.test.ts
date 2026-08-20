import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EnrichedEvent } from "@/lib/telemetry";

// The Pipelines binding is reached through getCloudflareContext(); the sink
// resolves it per flush, so the mock env is what each test swaps.
const sendMock = vi.hoisted(() => vi.fn<(records: unknown[]) => Promise<unknown>>());
const envMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: envMock.value }),
}));
// Run background work inline so a flush completes within the test.
vi.mock("@/lib/background-impl", () => ({
  afterResponse: (p: Promise<unknown>) => {
    void p.catch(() => {});
  },
}));

import { _internal } from "@/lib/telemetry-sinks-cf";

const { buffer, flushBuffer, pipelineSink } = _internal;

function event(op: string): EnrichedEvent {
  return { ts: "2026-08-20T05:00:00.000Z", domain: "upstream", op } as EnrichedEvent;
}

beforeEach(() => {
  buffer.length = 0;
  sendMock.mockReset().mockResolvedValue(undefined);
  envMock.value = { TELEMETRY_PIPELINE: { send: sendMock } };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pipeline sink flush", () => {
  it("sends buffered events wrapped as {value: event}", async () => {
    buffer.push(event("a"), event("b"));
    await flushBuffer();
    expect(sendMock).toHaveBeenCalledTimes(1);
    const records = sendMock.mock.calls[0][0] as Array<{ value: EnrichedEvent }>;
    expect(records.map((r) => r.value.op)).toEqual(["a", "b"]);
    expect(buffer).toHaveLength(0);
  });

  it("is a no-op when nothing is buffered", async () => {
    await flushBuffer();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("#524 — events survive a failed send", () => {
  it("re-queues the batch instead of dropping it", async () => {
    sendMock.mockRejectedValueOnce(
      new Error("Cannot perform I/O on behalf of a different request"),
    );
    buffer.push(event("a"), event("b"));

    await flushBuffer();
    // Dropped before the fix; now still pending.
    expect(buffer.map((e) => e.op)).toEqual(["a", "b"]);

    // Next flush runs in a healthy context and delivers them.
    await flushBuffer();
    expect(sendMock).toHaveBeenCalledTimes(2);
    const records = sendMock.mock.calls[1][0] as Array<{ value: EnrichedEvent }>;
    expect(records.map((r) => r.value.op)).toEqual(["a", "b"]);
    expect(buffer).toHaveLength(0);
  });

  it("re-queued events keep their order ahead of newer ones", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    buffer.push(event("old"));
    await flushBuffer();

    buffer.push(event("new"));
    await flushBuffer();

    const records = sendMock.mock.calls[1][0] as Array<{ value: EnrichedEvent }>;
    expect(records.map((r) => r.value.op)).toEqual(["old", "new"]);
  });

  it("re-queues when the binding is missing at flush time", async () => {
    buffer.push(event("a"));
    envMock.value = {}; // context without the binding
    await flushBuffer();
    expect(sendMock).not.toHaveBeenCalled();
    expect(buffer.map((e) => e.op)).toEqual(["a"]);
  });

  it("never lets a persistent outage grow the buffer without bound", async () => {
    sendMock.mockRejectedValue(new Error("still broken"));
    const total = _internal.MAX_BUFFERED_EVENTS + 50;
    for (let i = 0; i < total; i++) pipelineSink(event(`e${i}`));
    // Let every failed send settle and re-queue.
    await new Promise((r) => setTimeout(r, 0));
    await flushBuffer();
    await new Promise((r) => setTimeout(r, 0));

    // Bounded ...
    expect(buffer.length).toBeLessThanOrEqual(_internal.MAX_BUFFERED_EVENTS);
    // ... but still retaining events rather than dropping the lot, which is
    // the whole point: a broken sink must not silently undercount.
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("a failed send never throws into the caller", async () => {
    sendMock.mockRejectedValue(new Error("boom"));
    buffer.push(event("a"));
    await expect(flushBuffer()).resolves.toBeUndefined();
  });
});
