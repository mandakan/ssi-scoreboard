// Client-safe. Fire-and-forget UI interaction telemetry; see
// lib/ui-telemetry-schema.ts for the allowlist and privacy rules.

import type { UiTelemetryEvent } from "@/lib/ui-telemetry-schema";

const ENDPOINT = "/api/telemetry/ui";

/** Record a UI interaction. Never throws: telemetry must not break the UI. */
export function trackUi(ev: UiTelemetryEvent): void {
  const body = JSON.stringify(ev);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, body)) return;
    }
  } catch {
    // Fall through to fetch.
  }
  try {
    fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // No fetch either -- drop the event.
  }
}
