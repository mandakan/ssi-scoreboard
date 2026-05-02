// /api/v1/match/{ct}/{id} -- public, bearer-token-gated match overview.
//
// Thin wrapper around /api/match/[ct]/[id]. See docs/api-v1.md.

import { GET as innerGET } from "@/app/api/match/[ct]/[id]/route";
import { forwardToInternal, gateV1Request, mapInnerToV1 } from "@/lib/api-v1";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ct: string; id: string }> },
) {
  const gate = await gateV1Request(req);
  if (gate instanceof Response) return gate;

  const inner = await forwardToInternal(() => innerGET(req, { params }));
  return mapInnerToV1(inner, { notFoundMessage: "Match not found" });
}
