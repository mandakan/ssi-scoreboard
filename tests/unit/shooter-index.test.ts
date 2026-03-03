import { describe, it, expect } from "vitest";
import { decodeShooterId } from "@/lib/shooter-index";

describe("decodeShooterId", () => {
  it("decodes a valid ShooterNode Relay Global ID", () => {
    // base64("ShooterNode:41643") = "U2hvb3Rlck5vZGU6NDE2NDM="
    expect(decodeShooterId("U2hvb3Rlck5vZGU6NDE2NDM=")).toBe(41643);
  });

  it("decodes another known ID from the test fixture", () => {
    // base64("ShooterNode:39705") = "U2hvb3Rlck5vZGU6Mzk3MDU="
    expect(decodeShooterId("U2hvb3Rlck5vZGU6Mzk3MDU=")).toBe(39705);
  });

  it("decodes a large shooter ID correctly", () => {
    // base64("ShooterNode:59001") = "U2hvb3Rlck5vZGU6NTkwMDE="
    expect(decodeShooterId("U2hvb3Rlck5vZGU6NTkwMDE=")).toBe(59001);
  });

  it("returns null for null input", () => {
    expect(decodeShooterId(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(decodeShooterId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeShooterId("")).toBeNull();
  });

  it("returns null for a non-ShooterNode Relay ID (e.g. IpscMatchNode)", () => {
    // base64("IpscMatchNode:123")
    const encoded = Buffer.from("IpscMatchNode:123").toString("base64");
    expect(decodeShooterId(encoded)).toBeNull();
  });

  it("returns null for invalid base64", () => {
    expect(decodeShooterId("not-valid-base64!!!")).toBeNull();
  });

  it("returns null for a Relay ID with non-numeric pk", () => {
    const encoded = Buffer.from("ShooterNode:abc").toString("base64");
    expect(decodeShooterId(encoded)).toBeNull();
  });
});
