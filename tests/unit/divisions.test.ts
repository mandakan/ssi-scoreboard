import { describe, it, expect } from "vitest";
import { formatDivisionDisplay } from "@/lib/divisions";

describe("formatDivisionDisplay", () => {
  it("appends Major when shoots_handgun_major is true", () => {
    expect(formatDivisionDisplay("Open", true)).toBe("Open Major");
    expect(formatDivisionDisplay("Standard", true)).toBe("Standard Major");
  });

  it("appends Minor when shoots_handgun_major is false", () => {
    expect(formatDivisionDisplay("Open", false)).toBe("Open Minor");
    expect(formatDivisionDisplay("Production Optics", false)).toBe("Production Optics Minor");
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
