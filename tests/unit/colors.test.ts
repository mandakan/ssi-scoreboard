import { describe, it, expect } from "vitest";
import { buildColorMap, PALETTE } from "@/lib/colors";

describe("buildColorMap", () => {
  it("assigns colors by position index", () => {
    const map = buildColorMap([10, 20, 30]);
    expect(map[10]).toBe(PALETTE[0]);
    expect(map[20]).toBe(PALETTE[1]);
    expect(map[30]).toBe(PALETTE[2]);
  });

  it("returns an empty map for empty input", () => {
    expect(buildColorMap([])).toEqual({});
  });

  it("cycles through the palette when there are more ids than colors", () => {
    const ids = Array.from({ length: PALETTE.length + 2 }, (_, i) => i + 1);
    const map = buildColorMap(ids);
    expect(map[1]).toBe(PALETTE[0]);
    expect(map[PALETTE.length + 1]).toBe(PALETTE[0]); // wraps around
    expect(map[PALETTE.length + 2]).toBe(PALETTE[1]);
  });

  it("preserves order regardless of id values", () => {
    const map1 = buildColorMap([999, 1]);
    expect(map1[999]).toBe(PALETTE[0]);
    expect(map1[1]).toBe(PALETTE[1]);
  });
});
