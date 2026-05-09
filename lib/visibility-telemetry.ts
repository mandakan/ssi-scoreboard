// Server-only — never import from client components.
//
// Typed helper for the "visibility" telemetry domain (issue #426). Tracks how
// the classifier dispatches each cached match so we can verify the bot-role
// publishing primitive is reaching the right verdict in production, and watch
// for distribution shifts (e.g. a sudden spike in `organizer-published` would
// suggest someone batch-invited the bot).

import { telemetry } from "@/lib/telemetry";
import type { VisibilityClass } from "@/lib/types";

type VisibilityTelemetryEvent =
  | {
      op: "visibility-decision";
      matchKey: string;
      ct: number;
      id: string;
      rawCode: string;
      class: VisibilityClass;
    };

export function visibilityTelemetry(ev: VisibilityTelemetryEvent): void {
  telemetry({ domain: "visibility", ...ev });
}
