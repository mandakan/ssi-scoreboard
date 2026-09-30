import { describe, expect, it } from "vitest";
import { selectionSummary, shortName } from "@/lib/selection-summary";

describe("selectionSummary", () => {
  it("is empty for no names", () => expect(selectionSummary([])).toBe(""));
  it("shortens and joins up to two", () => {
    expect(selectionSummary(["Anna Lind", "Erik Svensson"])).toBe("Anna L., Erik S.");
  });
  it("counts the rest", () => {
    expect(selectionSummary(["Anna Lind", "Erik Svensson", "Bo Ek", "Al Bo"])).toBe("Anna L., Erik S. +2");
  });
  it("keeps initial-first names readable", () => {
    expect(shortName("A. Lindstrom")).toBe("A. Lindstrom");
  });
});
