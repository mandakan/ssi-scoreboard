// Default extra sinks — Docker / Node / dev. Console is registered by
// the core; this list is for transport sinks that need infra (R2, files,
// external HTTP). On Docker we have none.
//
// CF builds replace this module with `lib/telemetry-sinks-cf.ts` via the
// webpack/turbopack alias in next.config.ts (DEPLOY_TARGET=cloudflare).
import type { TelemetrySink } from "@/lib/telemetry";

export const extraSinks: TelemetrySink[] = [];
