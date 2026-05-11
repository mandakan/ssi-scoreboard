import { describe, expect, it } from "vitest";
import { computeAccessReason } from "@/lib/access-reason";

describe("computeAccessReason", () => {
  it("returns `public` for visibility=pub regardless of any role flags", () => {
    expect(
      computeAccessReason({
        visibility: "pub",
        is_current_role_staff: true,
        role_names: ["staff"],
      }),
    ).toEqual({ kind: "public", rawVisibility: "pub", role: null });
  });

  it("returns `service_admin_match` when admin flag is set on a non-public match", () => {
    expect(
      computeAccessReason({
        visibility: "clb",
        is_current_role_admin: true,
        role_names: ["admin"],
      }),
    ).toEqual({ kind: "service_admin_match", rawVisibility: "clb", role: "admin" });
  });

  it("returns `service_assistant_match` when only the assistant flag is set", () => {
    expect(
      computeAccessReason({ visibility: "res", is_current_role_assistant: true }),
    ).toEqual({ kind: "service_assistant_match", rawVisibility: "res", role: "assistant" });
  });

  it("returns `service_staff_match` when only the staff flag is set", () => {
    expect(
      computeAccessReason({
        visibility: "clb",
        is_current_role_staff: true,
        role_names: ["staff"],
      }),
    ).toEqual({ kind: "service_staff_match", rawVisibility: "clb", role: "staff" });
  });

  it("prefers admin > assistant > staff when multiple flags are set", () => {
    expect(
      computeAccessReason({
        visibility: "clb",
        is_current_role_admin: true,
        is_current_role_assistant: true,
        is_current_role_staff: true,
      }).kind,
    ).toBe("service_admin_match");

    expect(
      computeAccessReason({
        visibility: "clb",
        is_current_role_assistant: true,
        is_current_role_staff: true,
      }).kind,
    ).toBe("service_assistant_match");
  });

  it("returns `service_role_match` for role_names entries that aren't admin/assistant/staff", () => {
    expect(
      computeAccessReason({
        visibility: "csd",
        role_names: ["scorekeeper"],
      }),
    ).toEqual({ kind: "service_role_match", rawVisibility: "csd", role: "scorekeeper" });
  });

  it("uses the first role_names entry when multiple unknown roles are present", () => {
    expect(
      computeAccessReason({
        visibility: "csd",
        role_names: ["range_master", "scorekeeper"],
      }).role,
    ).toBe("range_master");
  });

  it("returns `unknown_visibility` when SSI returns a code we don't recognise", () => {
    expect(
      computeAccessReason({
        visibility: "future_code",
        is_current_role_staff: true,
      }),
    ).toEqual({ kind: "unknown_visibility", rawVisibility: "future_code", role: "staff" });
  });

  it("returns `unknown_visibility` for empty/missing visibility (defensive)", () => {
    expect(computeAccessReason({ visibility: "" }).kind).toBe("unknown_visibility");
    expect(computeAccessReason({}).kind).toBe("unknown_visibility");
    expect(computeAccessReason({ visibility: null }).kind).toBe("unknown_visibility");
  });

  it("returns `unauthorized_unexpected` for a non-public match with no role evidence", () => {
    // SSI returned us data on a private match and we don't know why. This is
    // the audit canary — should never fire in normal operation.
    expect(
      computeAccessReason({
        visibility: "clb",
        role_names: [],
      }),
    ).toEqual({ kind: "unauthorized_unexpected", rawVisibility: "clb", role: null });
  });

  it("treats lim (unlisted) as non-public — role still resolves the reason", () => {
    // lim = "Limited, not searchable and details/names for all" — public-ish
    // content but not indexed. We still want a non-public access reason.
    expect(
      computeAccessReason({
        visibility: "lim",
        is_current_role_staff: true,
      }).kind,
    ).toBe("service_staff_match");
  });

  it("does not promote a role_names entry over an explicit boolean for the same role", () => {
    expect(
      computeAccessReason({
        visibility: "clb",
        is_current_role_staff: true,
        role_names: ["staff", "scorekeeper"],
      }).kind,
    ).toBe("service_staff_match");
  });
});
