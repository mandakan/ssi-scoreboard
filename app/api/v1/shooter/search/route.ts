// /api/v1/shooter/search -- public, bearer-token-gated shooter name search.
//
// Thin wrapper around /api/shooter/search. See docs/api-v1.md.

import { GET as innerGET } from "@/app/api/shooter/search/route";
import { forwardToInternal, gateV1Request, mapInnerToV1 } from "@/lib/api-v1";

export async function GET(req: Request) {
  const gate = await gateV1Request(req);
  if (gate instanceof Response) return gate;

  const inner = await forwardToInternal(() => innerGET(req));
  return mapInnerToV1(inner);
}
