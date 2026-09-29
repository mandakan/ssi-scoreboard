import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGridSourcePreference,
  saveGridSourcePreference,
} from "@/lib/competition-store";

describe("grid source preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to squad", () => {
    expect(getGridSourcePreference("22", "1")).toBe("squad");
  });

  it("round-trips per match", () => {
    saveGridSourcePreference("22", "1", "tracked");
    expect(getGridSourcePreference("22", "1")).toBe("tracked");
    expect(getGridSourcePreference("22", "2")).toBe("squad");
  });

  it("treats garbage as squad", () => {
    localStorage.setItem("ssi_gridsource_22_1", "nonsense");
    expect(getGridSourcePreference("22", "1")).toBe("squad");
  });

  it("survives a throwing localStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getGridSourcePreference("22", "1")).toBe("squad");
    spy.mockRestore();
  });
});
