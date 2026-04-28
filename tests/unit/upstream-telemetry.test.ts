import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _resetTelemetryForTests } from "@/lib/telemetry";
import { upstreamTelemetry, hashVariables } from "@/lib/upstream-telemetry";

describe("upstreamTelemetry", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelemetryForTests();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    _resetTelemetryForTests();
  });

  it("emits with domain=upstream and op=graphql-request", () => {
    upstreamTelemetry({
      op: "graphql-request",
      operation: "GetMatch",
      ms: 124,
      outcome: "ok",
      httpStatus: 200,
      bytes: 8421,
      varsHash: "abc123",
    });
    const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(line.domain).toBe("upstream");
    expect(line.op).toBe("graphql-request");
    expect(line.operation).toBe("GetMatch");
    expect(line.outcome).toBe("ok");
    expect(line.ms).toBe(124);
    expect(line.bytes).toBe(8421);
  });

  it("supports each outcome variant", () => {
    const outcomes = ["ok", "http-error", "graphql-error", "timeout", "empty", "fetch-error"] as const;
    for (const outcome of outcomes) {
      upstreamTelemetry({ op: "graphql-request", operation: "X", ms: 1, outcome });
    }
    expect(infoSpy).toHaveBeenCalledTimes(outcomes.length);
  });
});

describe("hashVariables", () => {
  it("returns '0' for undefined", () => {
    expect(hashVariables(undefined)).toBe("0");
  });

  it("is deterministic for identical input", () => {
    const a = hashVariables({ ct: 22, id: "12345" });
    const b = hashVariables({ ct: 22, id: "12345" });
    expect(a).toBe(b);
  });

  it("differs across distinct inputs (probabilistic)", () => {
    const a = hashVariables({ ct: 22, id: "12345" });
    const b = hashVariables({ ct: 22, id: "67890" });
    expect(a).not.toBe(b);
  });

  it("returns a hex string", () => {
    expect(hashVariables({ a: 1 })).toMatch(/^[0-9a-f]+$/);
  });

  it("is sensitive to key order — JSON.stringify preserves insertion order", () => {
    // Documented limitation: callers passing the same logical vars in
    // different orders will get different hashes. That's fine for our use
    // case because callers always build the variables object the same way.
    const a = hashVariables({ ct: 22, id: "1" });
    const b = hashVariables({ id: "1", ct: 22 });
    expect(a).not.toBe(b);
  });
});
