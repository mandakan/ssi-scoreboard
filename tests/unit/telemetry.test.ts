import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  telemetry,
  registerSink,
  _resetTelemetryForTests,
  type EnrichedEvent,
} from "@/lib/telemetry";
import { _internal } from "@/lib/telemetry-sinks-cf";
import { cacheTelemetry } from "@/lib/cache-telemetry";

describe("telemetry core", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelemetryForTests();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    _resetTelemetryForTests();
  });

  it("emits one JSON line per event via console.info", () => {
    telemetry({ domain: "cache", op: "match-cache-permanent", matchKey: "foo", reason: "ttl-null" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const line = infoSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.domain).toBe("cache");
    expect(parsed.op).toBe("match-cache-permanent");
    expect(parsed.matchKey).toBe("foo");
    expect(typeof parsed.ts).toBe("string");
  });

  it("fan-outs to multiple sinks", () => {
    const seen: EnrichedEvent[] = [];
    registerSink((ev) => seen.push(ev));
    telemetry({ domain: "cache", op: "match-cache-permanent", matchKey: "k", reason: "ttl-null" });
    expect(seen).toHaveLength(1);
    expect(seen[0].matchKey).toBe("k");
    // Console sink also fires.
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows sink exceptions so telemetry never breaks the request path", () => {
    registerSink(() => { throw new Error("boom"); });
    expect(() =>
      telemetry({ domain: "cache", op: "match-cache-permanent", matchKey: "k", reason: "ttl-null" }),
    ).not.toThrow();
    // Other sinks (console) still fire.
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("cacheTelemetry() wraps with domain=cache", () => {
    cacheTelemetry({
      op: "match-ttl-decision",
      matchKey: "gql:GetMatch:22:12345",
      scoringPct: 95,
      daysSince: 1,
      status: "on",
      resultsPublished: false,
      trulyDone: false,
      ttl: 60,
    });
    const parsed = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(parsed.domain).toBe("cache");
    expect(parsed.op).toBe("match-ttl-decision");
    expect(parsed.trulyDone).toBe(false);
  });
});

describe("R2 sampler (signal mode)", () => {
  const { shouldSampleSignal } = _internal;

  function ev(fields: Partial<EnrichedEvent> & { domain: string; op: string }): EnrichedEvent {
    return { ts: "2026-04-28T00:00:00.000Z", ...fields } as EnrichedEvent;
  }

  it("keeps trulyDone ttl-decisions", () => {
    expect(
      shouldSampleSignal(ev({ domain: "cache", op: "match-ttl-decision", trulyDone: true })),
    ).toBe(true);
  });

  it("drops trulyDone=false ttl-decisions", () => {
    expect(
      shouldSampleSignal(ev({ domain: "cache", op: "match-ttl-decision", trulyDone: false })),
    ).toBe(false);
  });

  it("keeps schema-evict events unconditionally", () => {
    expect(shouldSampleSignal(ev({ domain: "cache", op: "match-cache-schema-evict" }))).toBe(true);
  });

  it("keeps stale reads, drops fresh reads", () => {
    expect(
      shouldSampleSignal(ev({ domain: "cache", op: "match-cache-read", stale: true })),
    ).toBe(true);
    expect(
      shouldSampleSignal(ev({ domain: "cache", op: "match-cache-read", stale: false })),
    ).toBe(false);
  });

  it("passes future non-cache domains through", () => {
    expect(shouldSampleSignal(ev({ domain: "ai", op: "rate-limit" }))).toBe(true);
  });
});

describe("R2 object key shape", () => {
  it("produces day-prefixed keys with a nonce", () => {
    const key = _internal.makeObjectKey(new Date("2026-04-28T13:24:05.123Z"));
    expect(key).toMatch(/^cache-telemetry\/2026-04-28\/132405-[0-9a-f]{6}\.ndjson$/);
  });

  it("two consecutive keys differ (nonce)", () => {
    const now = new Date("2026-04-28T13:24:05.123Z");
    const a = _internal.makeObjectKey(now);
    const b = _internal.makeObjectKey(now);
    // Statistical: collisions are 1/16M.
    expect(a).not.toBe(b);
  });
});
