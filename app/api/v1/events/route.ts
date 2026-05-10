// /api/v1/events -- public, bearer-token-gated event search.
//
// Thin wrapper around /api/events. Forwards query params verbatim and remaps
// errors into the v1 envelope. See docs/api-v1.md for the contract.

import { GET as innerGET } from "@/app/api/events/route";
import { forwardToInternal, gateV1Request, mapInnerToV1 } from "@/lib/api-v1";

export async function GET(req: Request) {
  const gate = await gateV1Request(req);
  if (gate instanceof Response) return gate;

  const url = new URL(req.url);
  // Replace the v1 prefix so the inner handler sees its own URL. We keep the
  // search params verbatim so consumers get the documented filtering knobs
  // (q, minLevel, country, starts_after, starts_before, firearms, live).
  const innerUrl = new URL(url.pathname.replace(/^\/api\/v1\//, "/api/") + url.search, url.origin);
  const innerReq = new Request(innerUrl, { headers: req.headers, method: "GET" });

  const inner = await forwardToInternal(() => innerGET(innerReq));
  const mapped = await mapInnerToV1(inner);

  // Preserve the v1 contract: each event entry exposes `scoring_completed`.
  // The internal /api/events stopped emitting it in #432 (the upstream SSI
  // field was deprecated and always returned 0); the v1 surface keeps it as
  // a constant 0 so external consumers pinning to the contract don't see a
  // removed field. Per docs/api-v1.md, removals are not allowed within v1
  // -- they belong to v2.
  if (!mapped.ok) return mapped;
  let body: unknown;
  try {
    body = await mapped.clone().json();
  } catch {
    return mapped;
  }
  if (!Array.isArray(body)) return mapped;
  const augmented = body.map((entry) =>
    entry && typeof entry === "object" && !("scoring_completed" in entry)
      ? { ...entry, scoring_completed: 0 }
      : entry,
  );
  const headers = new Headers(mapped.headers);
  headers.delete("Content-Length"); // body is reserialized below
  return new Response(JSON.stringify(augmented), {
    status: mapped.status,
    headers,
  });
}
