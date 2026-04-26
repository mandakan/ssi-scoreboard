import { describe, it, expect } from "vitest";
import { compactName, initialsName, rollCallName } from "@/lib/competitor-name";

describe("rollCallName", () => {
  it("keeps the first name and abbreviates the last name", () => {
    expect(rollCallName("Mathias Andersson")).toBe("Mathias A.");
  });

  it("uses the final token as the surname for multi-token names", () => {
    expect(rollCallName("Maria del Carmen Lopez")).toBe("Maria L.");
  });

  it("returns the only token when name has one part", () => {
    expect(rollCallName("Cher")).toBe("Cher");
  });

  it("uppercases the surname initial regardless of input casing", () => {
    expect(rollCallName("mathias andersson")).toBe("mathias A.");
  });

  it("trims and collapses whitespace", () => {
    expect(rollCallName("  Mathias   Andersson  ")).toBe("Mathias A.");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(rollCallName(null)).toBe("");
    expect(rollCallName(undefined)).toBe("");
    expect(rollCallName("")).toBe("");
  });
});

describe("compactName", () => {
  it("abbreviates the first name to a single initial", () => {
    expect(compactName("John Smith")).toBe("J. Smith");
  });

  it("abbreviates every token except the last", () => {
    expect(compactName("Maria del Carmen Lopez")).toBe("M. D. C. Lopez");
  });

  it("returns the only token when name has one part", () => {
    expect(compactName("Cher")).toBe("Cher");
  });

  it("uppercases the leading initial", () => {
    expect(compactName("mathias andersson")).toBe("M. andersson");
  });

  it("collapses multiple spaces", () => {
    expect(compactName("John   Smith")).toBe("J. Smith");
  });

  it("trims surrounding whitespace", () => {
    expect(compactName("  John Smith  ")).toBe("J. Smith");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(compactName(null)).toBe("");
    expect(compactName(undefined)).toBe("");
    expect(compactName("")).toBe("");
  });
});

describe("initialsName", () => {
  it("returns first + last initial for two-token names", () => {
    expect(initialsName("John Smith")).toBe("JS");
  });

  it("returns first + last initial for multi-token names", () => {
    expect(initialsName("Maria del Carmen Lopez")).toBe("ML");
  });

  it("returns the single initial for one-token names", () => {
    expect(initialsName("Cher")).toBe("C");
  });

  it("uppercases initials regardless of input casing", () => {
    expect(initialsName("mathias andersson")).toBe("MA");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(initialsName(null)).toBe("");
    expect(initialsName(undefined)).toBe("");
    expect(initialsName("")).toBe("");
  });
});
