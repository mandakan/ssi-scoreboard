import { describe, expect, it } from "vitest";
import {
  MATCH_TABS,
  isSameMatchPath,
  matchBasePath,
  matchTabFromPath,
  matchTabHref,
  ogImagePath,
  resolveLegacyMatchUrl,
} from "@/lib/match-routes";

describe("matchTabHref / matchTabFromPath", () => {
  it("round-trips every tab", () => {
    for (const tab of MATCH_TABS) {
      expect(matchTabFromPath(matchTabHref("22", "1", tab))).toBe(tab);
    }
  });
  it("grid is the bare match path", () => {
    expect(matchTabHref("22", "1", "grid")).toBe("/match/22/1");
  });
  it("tolerates a trailing slash", () => {
    expect(matchTabFromPath("/match/22/1/analysis/")).toBe("analysis");
  });
  it("unknown suffixes fall back to grid", () => {
    expect(matchTabFromPath("/match/22/1/whatever")).toBe("grid");
  });
});

describe("matchBasePath / ogImagePath", () => {
  it("strips tab suffixes", () => {
    expect(matchBasePath("/match/22/1/analysis")).toBe("/match/22/1");
    expect(matchBasePath("/match/22/1/info")).toBe("/match/22/1");
    expect(matchBasePath("/match/22/1")).toBe("/match/22/1");
  });
  it("builds the OG route from any tab", () => {
    expect(ogImagePath("/match/22/1/analysis")).toBe("/api/og/match/22/1");
    expect(ogImagePath("/match/22/1")).toBe("/api/og/match/22/1");
  });
});

describe("isSameMatchPath", () => {
  it("matches the base path and every tab", () => {
    expect(isSameMatchPath("/match/22/1", "22", "1")).toBe(true);
    expect(isSameMatchPath("/match/22/1/info", "22", "1")).toBe(true);
    expect(isSameMatchPath("/match/22/1/analysis", "22", "1")).toBe(true);
  });
  it("does not match a different match that shares a prefix", () => {
    expect(isSameMatchPath("/match/22/12", "22", "1")).toBe(false);
    expect(isSameMatchPath("/match/22/1x/info", "22", "1")).toBe(false);
    expect(isSameMatchPath("/", "22", "1")).toBe(false);
  });
});

describe("resolveLegacyMatchUrl", () => {
  const base = { ct: "22", id: "1", search: "", hash: "" };
  it("returns null for a plain grid URL", () => {
    expect(resolveLegacyMatchUrl(base)).toBeNull();
  });
  it("moves ?competitors to analysis, keeping the query", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=100,200" }))
      .toBe("/match/22/1/analysis?competitors=100,200");
  });
  it("moves #stage-N anchors to analysis", () => {
    expect(resolveLegacyMatchUrl({ ...base, hash: "#stage-3" }))
      .toBe("/match/22/1/analysis#stage-3");
  });
  it("keeps both query and anchor", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=5", hash: "#stage-2" }))
      .toBe("/match/22/1/analysis?competitors=5#stage-2");
  });
  it("ignores an empty competitors param and unrelated hashes", () => {
    expect(resolveLegacyMatchUrl({ ...base, search: "?competitors=" })).toBeNull();
    expect(resolveLegacyMatchUrl({ ...base, hash: "#main-content" })).toBeNull();
  });
});
