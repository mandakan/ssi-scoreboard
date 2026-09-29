import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLiveScoresOptIn, saveLiveScoresOptIn } from "@/lib/competition-store";

describe("live scores opt-in", () => {
  beforeEach(() => sessionStorage.clear());

  it("defaults to false", () => {
    expect(getLiveScoresOptIn("22", "1")).toBe(false);
  });

  it("round-trips per match, in sessionStorage only", () => {
    saveLiveScoresOptIn("22", "1");
    expect(getLiveScoresOptIn("22", "1")).toBe(true);
    expect(getLiveScoresOptIn("22", "2")).toBe(false);
    expect(sessionStorage.getItem("ssi_scores_optin_22_1")).not.toBeNull();
    expect(localStorage.getItem("ssi_scores_optin_22_1")).toBeNull();
  });

  it("survives a throwing storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getLiveScoresOptIn("22", "1")).toBe(false);
    expect(() => saveLiveScoresOptIn("22", "1")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
