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

describe("per-domain sampling", () => {
  const { getDomainRate, keepEvent, DEFAULT_RATES } = _internal;
  const ORIG_ENV = { ...process.env };

  function ev(domain: string): EnrichedEvent {
    return { ts: "2026-04-28T00:00:00.000Z", domain, op: "test" } as EnrichedEvent;
  }

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it("uses DEFAULT_RATES when no env override is set", () => {
    delete process.env.TELEMETRY_SAMPLE_CACHE;
    expect(getDomainRate("cache")).toBe(DEFAULT_RATES.cache);
    expect(getDomainRate("usage")).toBe(DEFAULT_RATES.usage);
  });

  it("env override wins over the default", () => {
    process.env.TELEMETRY_SAMPLE_USAGE = "0.5";
    expect(getDomainRate("usage")).toBe(0.5);
  });

  it("clamps env override to [0, 1]", () => {
    process.env.TELEMETRY_SAMPLE_CACHE = "5";
    expect(getDomainRate("cache")).toBe(1);
    process.env.TELEMETRY_SAMPLE_CACHE = "-1";
    expect(getDomainRate("cache")).toBe(0);
  });

  it("falls back to 1 for unknown domains with no env override", () => {
    delete process.env.TELEMETRY_SAMPLE_FOOBAR;
    expect(getDomainRate("foobar")).toBe(1);
  });

  it("rate=1 keeps every event", () => {
    process.env.TELEMETRY_SAMPLE_CACHE = "1";
    for (let i = 0; i < 50; i++) expect(keepEvent(ev("cache"))).toBe(true);
  });

  it("rate=0 drops every event", () => {
    process.env.TELEMETRY_SAMPLE_USAGE = "0";
    for (let i = 0; i < 50; i++) expect(keepEvent(ev("usage"))).toBe(false);
  });

  it("rate=0.5 lands between 30% and 70% over 1000 trials", () => {
    process.env.TELEMETRY_SAMPLE_USAGE = "0.5";
    let kept = 0;
    for (let i = 0; i < 1000; i++) if (keepEvent(ev("usage"))) kept++;
    expect(kept).toBeGreaterThan(300);
    expect(kept).toBeLessThan(700);
  });

  it("invalid env value falls back to default", () => {
    process.env.TELEMETRY_SAMPLE_CACHE = "not-a-number";
    expect(getDomainRate("cache")).toBe(DEFAULT_RATES.cache);
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
