import { describe, it, expect } from "vitest";
import { parseMatchUrl, formatHF, formatTime, formatPct, computePointsDelta, formatDelta } from "@/lib/utils";

describe("parseMatchUrl", () => {
  it("parses a valid shootnscoreit.com URL", () => {
    expect(
      parseMatchUrl("https://shootnscoreit.com/event/22/26547/")
    ).toEqual({ ct: "22", id: "26547" });
  });

  it("handles URLs without trailing slash", () => {
    expect(
      parseMatchUrl("https://shootnscoreit.com/event/22/26547")
    ).toBeNull(); // trailing slash is required by the regex
  });

  it("handles URLs with extra path segments after the ID", () => {
    expect(
      parseMatchUrl("https://shootnscoreit.com/event/22/26547/stage/1/")
    ).toEqual({ ct: "22", id: "26547" });
  });

  it("returns null for non-SSI URLs", () => {
    expect(parseMatchUrl("https://example.com/event/22/26547/")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMatchUrl("")).toBeNull();
  });

  it("returns null for a random string", () => {
    expect(parseMatchUrl("not a url")).toBeNull();
  });

  it("parses different numeric content_types", () => {
    expect(
      parseMatchUrl("https://shootnscoreit.com/event/30/99999/")
    ).toEqual({ ct: "30", id: "99999" });
  });
});

describe("formatHF", () => {
  it("formats a hit_factor to 2 decimal places", () => {
    expect(formatHF(5.0209205)).toBe("5.02");
  });

  it("returns em-dash for null", () => {
    expect(formatHF(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatHF(undefined)).toBe("—");
  });
});

describe("formatTime", () => {
  it("formats a time with 's' suffix", () => {
    expect(formatTime(14.34)).toBe("14.34s");
  });

  it("returns em-dash for null", () => {
    expect(formatTime(null)).toBe("—");
  });
});

describe("formatPct", () => {
  it("formats a percentage to 1 decimal place", () => {
    expect(formatPct(94.123)).toBe("94.1%");
  });

  it("returns em-dash for null", () => {
    expect(formatPct(null)).toBe("—");
  });
});

describe("computePointsDelta", () => {
  it("returns 0 for a tie (competitor equals group leader)", () => {
    expect(computePointsDelta(76, 76)).toBe(0);
  });

  it("returns negative delta when competitor is behind the leader", () => {
    expect(computePointsDelta(72, 76)).toBe(-4);
  });

  it("returns positive delta when competitor somehow exceeds leader (rounding edge)", () => {
    // group_leader_points may lag if computed from a subset; positive delta is valid
    expect(computePointsDelta(80, 76)).toBe(4);
  });

  it("returns null when competitor points are null (DNF)", () => {
    expect(computePointsDelta(null, 76)).toBeNull();
  });

  it("returns null when group_leader_points are null (no valid scorecards on stage)", () => {
    expect(computePointsDelta(72, null)).toBeNull();
  });

  it("returns null when both values are null", () => {
    expect(computePointsDelta(null, null)).toBeNull();
  });

  it("handles zero points (zeroed/DQ competitor vs leader)", () => {
    expect(computePointsDelta(0, 76)).toBe(-76);
  });
});

describe("formatDelta", () => {
  it("formats zero as '±0.0 pts'", () => {
    expect(formatDelta(0)).toBe("±0.0 pts");
  });

  it("formats a negative delta with real minus sign", () => {
    expect(formatDelta(-4.2)).toBe("\u22124.2 pts");
  });

  it("formats a positive delta with '+' prefix", () => {
    expect(formatDelta(3.5)).toBe("+3.5 pts");
  });

  it("rounds to 1 decimal place", () => {
    expect(formatDelta(-12.567)).toBe("\u221212.6 pts");
  });

  it("formats a large negative delta correctly", () => {
    expect(formatDelta(-100)).toBe("\u2212100.0 pts");
  });
});
