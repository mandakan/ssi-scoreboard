// Pure resolver: why did SSI return us match data?
//
// SSI's `IpscMatchNode.visibility` answers "how is this match published".
// `access_reason` answers a different question: "given that SSI returned us
// data on this match, what authorized it?". Both signals are stored side-by-
// side on `MatchResponse` because each has independent audit value.
//
// Decision precedence (see CLAUDE.md "Service account access reason"):
//   1. Public match  →  the access reason is "it's public, anyone can read".
//      Per-match roles, if any, are incidental and not load-bearing for audit.
//   2. Unknown visibility code  →  flag for telemetry; the rest of the
//      decision is ambiguous because we don't know SSI's intent.
//   3. Non-public + per-match role  →  explain by the role.
//   4. Non-public + no role  →  `unauthorized_unexpected` — SSI granted us
//      data via a path we don't model (group membership, looser club tie,
//      friend-of-friend, etc). This is the load-bearing audit canary.
//
// The function is pure: no I/O, no telemetry, no side-effects. Callers that
// want to emit `unknown_visibility_seen` or `unauthorized_unexpected_seen`
// alerts do so from the call site, not here.

import { classifyVisibility } from "@/lib/visibility";

/** Closed enum of access-reason buckets. Sorted by audit interest. */
export type AccessReasonKind =
  | "public"
  | "service_admin_match"
  | "service_assistant_match"
  | "service_staff_match"
  | "service_role_match"
  | "unknown_visibility"
  | "unauthorized_unexpected";

export interface AccessReason {
  kind: AccessReasonKind;
  /** Raw visibility code as returned by SSI (e.g. "pub", "clb", or a future
   *  unknown value). Preserved verbatim so future analysis can disambiguate
   *  even when the kind is `unknown_visibility`. */
  rawVisibility: string;
  /** First role string from `role_names` that drove the decision. Null on
   *  `public` and `unauthorized_unexpected`. */
  role: string | null;
}

export interface AccessReasonInput {
  visibility?: string | null;
  role_names?: readonly string[] | null;
  is_current_role_admin?: boolean | null;
  is_current_role_assistant?: boolean | null;
  is_current_role_staff?: boolean | null;
}

/** SSI's documented visibility short codes (issue #426). Kept in sync with
 *  `CLASS_BY_RAW` in `lib/visibility.ts` — when adding a new code there,
 *  add it here too so the resolver doesn't bucket it as unknown. */
const KNOWN_VISIBILITY_CODES: ReadonlySet<string> = new Set([
  "pub",
  "lim",
  "res",
  "csd",
  "clb",
]);

export function computeAccessReason(input: AccessReasonInput): AccessReason {
  const rawVisibility = input.visibility ?? "";
  const klass = classifyVisibility(rawVisibility);
  const roleNames = input.role_names ?? [];

  if (klass === "public") {
    return { kind: "public", rawVisibility, role: null };
  }

  if (!KNOWN_VISIBILITY_CODES.has(rawVisibility)) {
    // Preserve role evidence even when visibility is ambiguous — the audit
    // bucket is `unknown_visibility` but we still want to know what role
    // (if any) we apparently held at the time of access.
    return {
      kind: "unknown_visibility",
      rawVisibility,
      role: resolveRoleHint(input),
    };
  }

  if (input.is_current_role_admin) {
    return { kind: "service_admin_match", rawVisibility, role: "admin" };
  }
  if (input.is_current_role_assistant) {
    return { kind: "service_assistant_match", rawVisibility, role: "assistant" };
  }
  if (input.is_current_role_staff) {
    return { kind: "service_staff_match", rawVisibility, role: "staff" };
  }
  if (roleNames.length > 0) {
    return { kind: "service_role_match", rawVisibility, role: roleNames[0] };
  }

  return { kind: "unauthorized_unexpected", rawVisibility, role: null };
}

function resolveRoleHint(input: AccessReasonInput): string | null {
  if (input.is_current_role_admin) return "admin";
  if (input.is_current_role_assistant) return "assistant";
  if (input.is_current_role_staff) return "staff";
  return input.role_names?.[0] ?? null;
}
