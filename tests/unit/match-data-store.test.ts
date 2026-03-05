import { describe, it, expect } from "vitest";
import { parseMatchCacheKey } from "@/lib/match-data-store";

describe("parseMatchCacheKey", () => {
  it("parses gql:GetMatch keys", () => {
    const result = parseMatchCacheKey('gql:GetMatch:{"ct":22,"id":"26547"}');
    expect(result).toEqual({ keyType: "match", ct: 22, matchId: "26547" });
  });

  it("parses gql:GetMatchScorecards keys", () => {
    const result = parseMatchCacheKey('gql:GetMatchScorecards:{"ct":22,"id":"26547"}');
    expect(result).toEqual({ keyType: "scorecards", ct: 22, matchId: "26547" });
  });

  it("parses computed:matchglobal keys", () => {
    const result = parseMatchCacheKey("computed:matchglobal:22:26547");
    expect(result).toEqual({ keyType: "matchglobal", ct: 22, matchId: "26547" });
  });

  it("returns null for unrecognized keys", () => {
    expect(parseMatchCacheKey("computed:shooter:123:dashboard")).toBeNull();
    expect(parseMatchCacheKey("gql:GetEvents:{}")).toBeNull();
    expect(parseMatchCacheKey("random:key")).toBeNull();
  });

  it("returns null for malformed JSON in gql keys", () => {
    expect(parseMatchCacheKey("gql:GetMatch:{invalid}")).toBeNull();
    expect(parseMatchCacheKey("gql:GetMatchScorecards:{invalid}")).toBeNull();
  });

  it("returns null for matchglobal with missing parts", () => {
    expect(parseMatchCacheKey("computed:matchglobal:")).toBeNull();
    expect(parseMatchCacheKey("computed:matchglobal:22")).toBeNull();
  });

  it("handles numeric match IDs in matchglobal keys", () => {
    const result = parseMatchCacheKey("computed:matchglobal:22:99999");
    expect(result).toEqual({ keyType: "matchglobal", ct: 22, matchId: "99999" });
  });
});
