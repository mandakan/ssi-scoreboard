import { describe, it, expect } from "vitest";
import { buildSubWindows, MAX_SUB_WINDOWS, SUB_WINDOW_DAYS } from "@/lib/events-windows";

describe("buildSubWindows", () => {
  it("splits a one-month range into 7-day windows", () => {
    const { windows, clamped } = buildSubWindows("2026-08-01", "2026-08-29", {});
    expect(windows).toHaveLength(4);
    expect(clamped).toBe(false);
    expect(windows[0]).toEqual({ starts_after: "2026-08-01", starts_before: "2026-08-08" });
    expect(windows[3]).toEqual({ starts_after: "2026-08-22", starts_before: "2026-08-29" });
  });

  it("clips the final window to the range end", () => {
    const { windows } = buildSubWindows("2026-08-01", "2026-08-10", {});
    expect(windows).toHaveLength(2);
    expect(windows[1].starts_before).toBe("2026-08-10");
  });

  it("carries base vars into every window", () => {
    const { windows } = buildSubWindows("2026-08-01", "2026-08-10", { firearms: "hg" });
    expect(windows.every((w) => w.firearms === "hg")).toBe(true);
  });

  it("clamps a multi-year range to MAX_SUB_WINDOWS windows anchored at the range start", () => {
    const { windows, clamped } = buildSubWindows("2024-01-01", "2026-12-31", {});
    expect(windows).toHaveLength(MAX_SUB_WINDOWS);
    expect(clamped).toBe(true);
    expect(windows[0].starts_after).toBe("2024-01-01");
    // Last window ends exactly MAX_SUB_WINDOWS * SUB_WINDOW_DAYS days in.
    const expectedEnd = new Date("2024-01-01");
    expectedEnd.setDate(expectedEnd.getDate() + MAX_SUB_WINDOWS * SUB_WINDOW_DAYS);
    expect(windows[MAX_SUB_WINDOWS - 1].starts_before).toBe(expectedEnd.toISOString().slice(0, 10));
  });

  it("does not clamp a range that lands exactly on the cap", () => {
    const end = new Date("2026-08-01");
    end.setDate(end.getDate() + MAX_SUB_WINDOWS * SUB_WINDOW_DAYS);
    const { windows, clamped } = buildSubWindows("2026-08-01", end.toISOString().slice(0, 10), {});
    expect(windows).toHaveLength(MAX_SUB_WINDOWS);
    expect(clamped).toBe(false);
  });

  it("returns no windows for an empty or inverted range", () => {
    expect(buildSubWindows("2026-08-10", "2026-08-10", {}).windows).toHaveLength(0);
    expect(buildSubWindows("2026-08-10", "2026-08-01", {}).windows).toHaveLength(0);
  });
});
