import { describe, it, expect } from "vitest";
import { formatDivisionDisplay, abbreviateDivision } from "@/lib/divisions";

describe("formatDivisionDisplay", () => {
  it("appends Major when shoots_handgun_major is true", () => {
    expect(formatDivisionDisplay("Open", true)).toBe("Open Major");
    expect(formatDivisionDisplay("Standard", true)).toBe("Standard Major");
  });

  it("appends Minor when shoots_handgun_major is false", () => {
    expect(formatDivisionDisplay("Open", false)).toBe("Open Minor");
  });

  it("returns base name for Production regardless of shoots_handgun_major", () => {
    expect(formatDivisionDisplay("Production", true)).toBe("Production");
    expect(formatDivisionDisplay("Production", false)).toBe("Production");
  });

  it("returns base name for Production Optics regardless of shoots_handgun_major", () => {
    expect(formatDivisionDisplay("Production Optics", true)).toBe("Production Optics");
    expect(formatDivisionDisplay("Production Optics", false)).toBe("Production Optics");
  });

  it("returns base name when shoots_handgun_major is null", () => {
    expect(formatDivisionDisplay("Production", null)).toBe("Production");
    expect(formatDivisionDisplay("Open", null)).toBe("Open");
  });

  it("returns base name when shoots_handgun_major is undefined", () => {
    expect(formatDivisionDisplay("Production", undefined)).toBe("Production");
  });

  it("returns null when display name is null", () => {
    expect(formatDivisionDisplay(null, true)).toBeNull();
  });

  it("returns null when display name is undefined", () => {
    expect(formatDivisionDisplay(undefined, false)).toBeNull();
  });

  it("returns null when display name is empty string", () => {
    expect(formatDivisionDisplay("", true)).toBeNull();
  });
});

describe("abbreviateDivision", () => {
  it("returns short codes for known IPSC divisions with power factor", () => {
    expect(abbreviateDivision("Open Major")).toBe("O+");
    expect(abbreviateDivision("Open Minor")).toBe("O-");
    expect(abbreviateDivision("Standard Major")).toBe("S+");
    expect(abbreviateDivision("Standard Minor")).toBe("S-");
    expect(abbreviateDivision("Classic Major")).toBe("C+");
    expect(abbreviateDivision("Classic Minor")).toBe("C-");
  });

  it("returns short codes for single-power-factor divisions", () => {
    expect(abbreviateDivision("Production")).toBe("P");
    expect(abbreviateDivision("Production Optics")).toBe("PO");
    expect(abbreviateDivision("Production Optics Light")).toBe("POL");
    expect(abbreviateDivision("Revolver")).toBe("R");
    expect(abbreviateDivision("PCC")).toBe("PCC");
  });

  it("returns base division when power factor is unknown", () => {
    expect(abbreviateDivision("Open")).toBe("O");
    expect(abbreviateDivision("Standard")).toBe("S");
    expect(abbreviateDivision("Classic")).toBe("C");
  });

  it("falls back to first letters of each word for unknown divisions", () => {
    expect(abbreviateDivision("Air Soft Tactical")).toBe("AST");
    expect(abbreviateDivision("Foo")).toBe("F");
  });

  it("trims whitespace before lookup", () => {
    expect(abbreviateDivision("  Production Optics  ")).toBe("PO");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(abbreviateDivision(null)).toBe("");
    expect(abbreviateDivision(undefined)).toBe("");
    expect(abbreviateDivision("")).toBe("");
  });
});
