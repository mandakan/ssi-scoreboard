// Server-only — never import from client components.
//
// Typed helper for the "error" telemetry domain. Use it at swallowed-catch
// sites where a full throw would break the user-facing flow but a silent
// drop hides bugs. Records:
//   - op:          short label for the failed operation (caller's choice)
//   - errorClass:  err.name when err is an Error, else "unknown"
//   - errorMsg:    truncated to 200 chars, scrubbed of obvious PII tokens
//   - extra:       opt-in caller-provided primitives (matchKey, shooterId, ...)
//
// We deliberately do NOT log stack traces — they can contain file paths
// from arbitrary user input and inflate R2 storage. The class + truncated
// message + op label is enough to grep for trends.

import { telemetry } from "@/lib/telemetry";

export interface ErrorEvent {
  op: "swallowed";
  /** Caller-chosen label, e.g. "match-cache-write" or "shooter-backfill". */
  site: string;
  errorClass: string;
  /** Truncated to 200 chars. */
  errorMsg: string;
  // ── opt-in context (any subset) ─────────────────────────────────────
  matchKey?: string | null;
  shooterId?: number | null;
  /** Content-type discriminator. Stored as-is — callers pass either number or string. */
  ct?: number | string | null;
  matchId?: string | null;
}

export function reportError(
  site: string,
  err: unknown,
  extra: Omit<ErrorEvent, "op" | "site" | "errorClass" | "errorMsg"> = {},
): void {
  const errorClass = err instanceof Error ? err.name : "unknown";
  const rawMsg = err instanceof Error ? err.message : String(err);
  const errorMsg = rawMsg.length > 200 ? rawMsg.slice(0, 200) + "…" : rawMsg;
  telemetry({ domain: "error", op: "swallowed", site, errorClass, errorMsg, ...extra });
}
