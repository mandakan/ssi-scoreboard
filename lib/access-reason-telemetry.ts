// Server-only — never import from client components.
//
// Typed wrapper for the `access-reason` telemetry domain.
//
// Two event shapes:
//   - `access-reason-decision`: emitted once per match parse — the routine
//     audit signal. Carries the resolved bucket (`kind`), the raw visibility
//     code, and the role string that drove the decision.
//   - `access-reason-anomaly`: emitted at most once per (kind, rawVisibility,
//     role) tuple per process for the audit-canary buckets
//     (`unknown_visibility`, `unauthorized_unexpected`). The decision event
//     itself is high-volume; the anomaly event is the low-volume alerting
//     signal you'd page on or drill into.

import { telemetry } from "@/lib/telemetry";
import type { AccessReasonKind } from "@/lib/access-reason";

type AccessReasonTelemetryEvent =
  | {
      op: "access-reason-decision";
      matchKey: string;
      ct: number;
      id: string;
      kind: AccessReasonKind;
      rawVisibility: string;
      role: string | null;
    }
  | {
      op: "access-reason-anomaly";
      matchKey: string;
      ct: number;
      id: string;
      kind: "unknown_visibility" | "unauthorized_unexpected";
      rawVisibility: string;
      role: string | null;
    };

/** In-memory de-dup set for anomaly alerts. Cold starts re-emit, which is
 *  the intended behaviour: each Worker/Node instance independently flags
 *  unexpected access so we don't lose the signal if one instance restarts. */
const seenAnomalies = new Set<string>();

export function accessReasonTelemetry(ev: AccessReasonTelemetryEvent): void {
  telemetry({ domain: "access-reason", ...ev });
  if (ev.op !== "access-reason-decision") return;
  if (ev.kind !== "unknown_visibility" && ev.kind !== "unauthorized_unexpected") return;
  const dedupKey = `${ev.kind}::${ev.rawVisibility}::${ev.role ?? ""}`;
  if (seenAnomalies.has(dedupKey)) return;
  seenAnomalies.add(dedupKey);
  telemetry({
    domain: "access-reason",
    op: "access-reason-anomaly",
    matchKey: ev.matchKey,
    ct: ev.ct,
    id: ev.id,
    kind: ev.kind,
    rawVisibility: ev.rawVisibility,
    role: ev.role,
  });
}

/** Test-only: clear the anomaly de-dup set between tests. */
export function _resetAccessReasonTelemetryForTests(): void {
  seenAnomalies.clear();
}
