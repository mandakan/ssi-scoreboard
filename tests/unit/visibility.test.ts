import { describe, it, expect } from "vitest";
import { classifyVisibility, isPublicMatchData } from "@/lib/visibility";

describe("classifyVisibility", () => {
  it("maps pub -> public", () => {
    expect(classifyVisibility("pub")).toBe("public");
  });

  it("maps lim -> unlisted", () => {
    expect(classifyVisibility("lim")).toBe("unlisted");
  });

  it.each(["res", "csd", "clb"])(
    "maps %s -> organizer-published",
    (code) => {
      expect(classifyVisibility(code)).toBe("organizer-published");
    },
  );

  it("falls back to organizer-published for unknown codes (defensive)", () => {
    // If SSI adds a new restrictive code in the future, treat it as
    // organizer-published rather than accidentally exposing it as public.
    expect(classifyVisibility("xyz")).toBe("organizer-published");
  });

  it("treats null/undefined/empty as organizer-published", () => {
    expect(classifyVisibility(null)).toBe("organizer-published");
    expect(classifyVisibility(undefined)).toBe("organizer-published");
    expect(classifyVisibility("")).toBe("organizer-published");
  });
});

describe("isPublicMatchData", () => {
  it("accepts raw GraphQL shape with event.visibility=pub", () => {
    expect(isPublicMatchData({ event: { visibility: "pub" } })).toBe(true);
  });

  it("accepts shaped MatchResponse with visibility.class=public", () => {
    expect(isPublicMatchData({ visibility: { class: "public" } })).toBe(true);
  });

  it.each(["lim", "res", "csd", "clb", "xyz"])(
    "rejects raw event.visibility=%s",
    (code) => {
      expect(isPublicMatchData({ event: { visibility: code } })).toBe(false);
    },
  );

  it.each(["unlisted", "organizer-published"])(
    "rejects shaped visibility.class=%s",
    (cls) => {
      expect(isPublicMatchData({ visibility: { class: cls } })).toBe(false);
    },
  );

  it("rejects missing / malformed shapes (defensive)", () => {
    expect(isPublicMatchData(null)).toBe(false);
    expect(isPublicMatchData(undefined)).toBe(false);
    expect(isPublicMatchData({})).toBe(false);
    expect(isPublicMatchData({ event: {} })).toBe(false);
    expect(isPublicMatchData({ event: null })).toBe(false);
    expect(isPublicMatchData({ visibility: null })).toBe(false);
    expect(isPublicMatchData("pub")).toBe(false);
  });
});
