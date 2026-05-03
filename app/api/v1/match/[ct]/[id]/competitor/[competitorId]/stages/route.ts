// /api/v1/match/{ct}/{id}/competitor/{competitorId}/stages -- public,
// bearer-token-gated per-competitor stage results.
//
// Thin wrapper around the internal /api/match/[ct]/[id]/competitor/[competitorId]/stages
// route. See docs/api-v1.md.

import { GET as innerGET } from "@/app/api/match/[ct]/[id]/competitor/[competitorId]/stages/route";
import { forwardToInternal, gateV1Request, mapInnerToV1 } from "@/lib/api-v1";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ct: string; id: string; competitorId: string }> },
) {
  const gate = await gateV1Request(req);
  if (gate instanceof Response) return gate;

  const inner = await forwardToInternal(() => innerGET(req, { params }));
  return mapInnerToV1(inner, {
    notFoundMessage: "Match or competitor not found",
  });
}
