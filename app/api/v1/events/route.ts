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
  return mapInnerToV1(inner);
}
