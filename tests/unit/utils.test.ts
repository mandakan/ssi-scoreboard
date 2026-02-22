import { describe, it, expect } from "vitest";
import { parseMatchUrl, formatHF, formatTime, formatPct } from "@/lib/utils";

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
