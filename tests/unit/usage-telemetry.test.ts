import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _resetTelemetryForTests } from "@/lib/telemetry";
import { usageTelemetry, bucketCount, bucketScoring, bucketGridRows } from "@/lib/usage-telemetry";

describe("bucketCount", () => {
  it("buckets 0", () => expect(bucketCount(0)).toBe("0"));
  it("buckets negatives as 0", () => expect(bucketCount(-1)).toBe("0"));
  it("buckets 1-9", () => {
    expect(bucketCount(1)).toBe("1-9");
    expect(bucketCount(5)).toBe("1-9");
    expect(bucketCount(9)).toBe("1-9");
  });
  it("buckets 10-99", () => {
    expect(bucketCount(10)).toBe("10-99");
    expect(bucketCount(50)).toBe("10-99");
    expect(bucketCount(99)).toBe("10-99");
  });
  it("buckets 100+", () => {
    expect(bucketCount(100)).toBe("100+");
    expect(bucketCount(999_999)).toBe("100+");
  });
});

describe("bucketScoring", () => {
  it("0 → pre", () => expect(bucketScoring(0)).toBe("pre"));
  it("1-99 → active", () => {
    expect(bucketScoring(1)).toBe("active");
    expect(bucketScoring(50)).toBe("active");
    expect(bucketScoring(99)).toBe("active");
  });
  it("100+ → complete", () => {
    expect(bucketScoring(100)).toBe("complete");
    expect(bucketScoring(101)).toBe("complete"); // upstream sometimes returns >100
  });
});

describe("bucketGridRows", () => {
  it("1", () => expect(bucketGridRows(1)).toBe("1"));
  it("0 and negatives clamp to 1", () => {
    expect(bucketGridRows(0)).toBe("1");
    expect(bucketGridRows(-3)).toBe("1");
  });
  it("2-5", () => {
    expect(bucketGridRows(2)).toBe("2-5");
    expect(bucketGridRows(5)).toBe("2-5");
  });
  it("6-12", () => {
    expect(bucketGridRows(6)).toBe("6-12");
    expect(bucketGridRows(12)).toBe("6-12");
  });
  it("13-20", () => {
    expect(bucketGridRows(13)).toBe("13-20");
    expect(bucketGridRows(20)).toBe("13-20");
    expect(bucketGridRows(99)).toBe("13-20");
  });
});

describe("usageTelemetry", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelemetryForTests();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    _resetTelemetryForTests();
  });

  it("emits domain=usage with the given op + fields", () => {
    usageTelemetry({
      op: "match-view",
      ct: 22,
      level: "l3",
      region: "SWE",
      scoringBucket: "complete",
      cacheHit: true,
    });
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.domain).toBe("usage");
    expect(line.op).toBe("match-view");
    expect(line.ct).toBe(22);
    expect(line.level).toBe("l3");
    expect(line.region).toBe("SWE");
    expect(line.scoringBucket).toBe("complete");
    expect(line.cacheHit).toBe(true);
  });

  it("supports each op variant", () => {
    usageTelemetry({ op: "match-view", ct: 22, level: null, region: null, scoringBucket: "pre", cacheHit: false });
    usageTelemetry({ op: "comparison", ct: 22, mode: "coaching", nCompetitors: 3 });
    usageTelemetry({ op: "search", kind: "shooter", queryLength: 5, resultBucket: "1-9" });
    usageTelemetry({ op: "browse", kind: "events", resultBucket: "10-99" });
    usageTelemetry({ op: "shooter-dashboard-view", matchCountBucket: "10-99", cacheHit: true });
    usageTelemetry({ op: "og-render", ct: 22, variant: "multi", nCompetitors: 4 });
    expect(infoSpy).toHaveBeenCalledTimes(6);
  });

  it("emits live-grid-view with bucketed rows and no ids", () => {
    usageTelemetry({ op: "live-grid-view", ct: 22, rowsBucket: "6-12", restricted: false });
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ domain: "usage", op: "live-grid-view", ct: 22, rowsBucket: "6-12", restricted: false });
    expect(line.competitorIds).toBeUndefined();
    expect(line.matchId).toBeUndefined();
  });

  it("never logs query strings — only lengths", () => {
    usageTelemetry({ op: "search", kind: "shooter", queryLength: 12, resultBucket: "0" });
    const parsed = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(parsed.queryLength).toBe(12);
    // No raw text fields under any of the names a search query might land in.
    expect(parsed.query).toBeUndefined();
    expect(parsed.q).toBeUndefined();
    expect(parsed.text).toBeUndefined();
    expect(parsed.term).toBeUndefined();
  });
});
