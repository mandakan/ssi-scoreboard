import { describe, it, expect } from "vitest";
import { detectMode } from "@/lib/mode";

describe("detectMode", () => {
  it("returns 'live' for active match (0% scored, day 0)", () => {
    expect(detectMode(0, 0)).toBe("live");
  });

  it("returns 'live' for active match (50% scored, day 1)", () => {
    expect(detectMode(50, 1)).toBe("live");
  });

  it("returns 'live' just below threshold (94% scored, day 3)", () => {
    expect(detectMode(94, 3)).toBe("live");
  });

  it("returns 'coaching' at 95% scored", () => {
    expect(detectMode(95, 0)).toBe("coaching");
  });

  it("returns 'coaching' at 100% scored", () => {
    expect(detectMode(100, 0)).toBe("coaching");
  });

  it("returns 'coaching' when > 3 days old even if 0% scored", () => {
    expect(detectMode(0, 4)).toBe("coaching");
  });

  it("returns 'live' at exactly 3 days", () => {
    expect(detectMode(0, 3)).toBe("live");
  });

  it("returns 'coaching' at 3.01 days", () => {
    expect(detectMode(0, 3.01)).toBe("coaching");
  });
});
