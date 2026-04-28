import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _resetTelemetryForTests } from "@/lib/telemetry";
import { reportError } from "@/lib/error-telemetry";

describe("reportError", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelemetryForTests();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    _resetTelemetryForTests();
  });

  it("emits domain=error op=swallowed with site label", () => {
    reportError("foo.bar", new TypeError("nope"));
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.domain).toBe("error");
    expect(line.op).toBe("swallowed");
    expect(line.site).toBe("foo.bar");
    expect(line.errorClass).toBe("TypeError");
    expect(line.errorMsg).toBe("nope");
  });

  it("classifies non-Error throwables as 'unknown'", () => {
    reportError("foo.bar", "raw string");
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.errorClass).toBe("unknown");
    expect(line.errorMsg).toBe("raw string");
  });

  it("truncates long messages to 200 chars + ellipsis", () => {
    const longMsg = "x".repeat(500);
    reportError("foo.bar", new Error(longMsg));
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.errorMsg.length).toBe(201); // 200 chars + "…"
    expect(line.errorMsg.endsWith("…")).toBe(true);
  });

  it("forwards optional context fields", () => {
    reportError("cache.write", new Error("boom"), {
      matchKey: "gql:GetMatch:foo",
      shooterId: 12345,
      ct: 22,
      matchId: "67890",
    });
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.matchKey).toBe("gql:GetMatch:foo");
    expect(line.shooterId).toBe(12345);
    expect(line.ct).toBe(22);
    expect(line.matchId).toBe("67890");
  });

  it("does not include a stack trace", () => {
    reportError("foo.bar", new Error("boom"));
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.stack).toBeUndefined();
  });
});
