import { describe, it, expect, afterEach } from "vitest";
import {
  isSsiUpstreamPaused,
  assertSsiUpstreamAllowed,
  UPSTREAM_PAUSED_ERROR,
} from "@/lib/upstream-pause";

const ORIGINAL = process.env.SSI_UPSTREAM_PAUSED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SSI_UPSTREAM_PAUSED;
  else process.env.SSI_UPSTREAM_PAUSED = ORIGINAL;
});

describe("isSsiUpstreamPaused", () => {
  it("is not paused when the env var is unset", () => {
    delete process.env.SSI_UPSTREAM_PAUSED;
    expect(isSsiUpstreamPaused()).toBe(false);
  });

  it.each(["on", "true", "1", "ON", "yes", "paused"])(
    "is paused when set to %j",
    (v) => {
      process.env.SSI_UPSTREAM_PAUSED = v;
      expect(isSsiUpstreamPaused()).toBe(true);
    },
  );

  it.each(["", "off", "0", "false", "OFF", "  off  "])(
    "is not paused when set to %j",
    (v) => {
      process.env.SSI_UPSTREAM_PAUSED = v;
      expect(isSsiUpstreamPaused()).toBe(false);
    },
  );
});

describe("assertSsiUpstreamAllowed", () => {
  it("throws the pause error when paused", () => {
    process.env.SSI_UPSTREAM_PAUSED = "on";
    expect(() => assertSsiUpstreamAllowed()).toThrow(UPSTREAM_PAUSED_ERROR);
  });

  it("does not throw when not paused", () => {
    delete process.env.SSI_UPSTREAM_PAUSED;
    expect(() => assertSsiUpstreamAllowed()).not.toThrow();
  });
});
