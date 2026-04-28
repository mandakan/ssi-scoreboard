import { describe, it, expect } from "vitest";
import {
  buildColorMap,
  buildShapeMap,
  PALETTE,
  SHAPE_PALETTE,
} from "@/lib/colors";

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

  it("uses an Okabe-Ito-derived palette of 8 colors", () => {
    expect(PALETTE).toHaveLength(8);
    expect(PALETTE).toContain("#0072B2"); // Okabe-Ito blue
    expect(PALETTE).toContain("#D55E00"); // vermillion
    expect(PALETTE).toContain("#009E73"); // bluish green
  });
});

describe("buildShapeMap", () => {
  it("assigns shapes by position index, parallel to colors", () => {
    const map = buildShapeMap([10, 20, 30]);
    expect(map[10]).toBe(SHAPE_PALETTE[0]);
    expect(map[20]).toBe(SHAPE_PALETTE[1]);
    expect(map[30]).toBe(SHAPE_PALETTE[2]);
  });

  it("returns an empty map for empty input", () => {
    expect(buildShapeMap([])).toEqual({});
  });

  it("cycles when there are more ids than shapes", () => {
    const ids = Array.from({ length: SHAPE_PALETTE.length + 1 }, (_, i) => i + 1);
    const map = buildShapeMap(ids);
    expect(map[SHAPE_PALETTE.length + 1]).toBe(SHAPE_PALETTE[0]);
  });

  it("has a length coprime with PALETTE so (color, shape) tuples are unique past one cycle", () => {
    // gcd(8, 7) === 1: any two indices i, j with i ≠ j and i, j < 56
    // produce different (color, shape) pairs.
    function gcd(a: number, b: number): number {
      return b === 0 ? a : gcd(b, a % b);
    }
    expect(gcd(PALETTE.length, SHAPE_PALETTE.length)).toBe(1);
  });

  it("produces unique (color, shape) tuples for the first 12 competitor indices", () => {
    const seen = new Set<string>();
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const colorMap = buildColorMap(ids);
    const shapeMap = buildShapeMap(ids);
    for (const id of ids) {
      const tuple = `${colorMap[id]}|${shapeMap[id]}`;
      expect(seen.has(tuple)).toBe(false);
      seen.add(tuple);
    }
  });
});
