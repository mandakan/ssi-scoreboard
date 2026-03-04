// CF Workers background-work scheduler — Cloudflare Pages target.
// Registers background promises with ctx.waitUntil() so the Workers runtime
// keeps the isolate alive until the promise resolves, even after the HTTP
// response has been sent. Without this, fire-and-forget D1 writes are
// silently terminated when the response is returned.
import { getCloudflareContext } from "@opennextjs/cloudflare";

type CFContext = { ctx: { waitUntil(p: Promise<unknown>): void } };

export function afterResponse(promise: Promise<void>): void {
  try {
    const { ctx } = getCloudflareContext() as unknown as CFContext;
    ctx.waitUntil(promise);
  } catch {
    // Context unavailable — promise is already in-flight, best-effort.
    void promise;
  }
}
