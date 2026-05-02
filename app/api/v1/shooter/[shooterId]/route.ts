// /api/v1/shooter/{shooterId} -- public, bearer-token-gated shooter dashboard.
//
// Thin wrapper around /api/shooter/[shooterId]. The DELETE endpoint on the
// internal route (GDPR suppression) is intentionally not re-exported here:
// destructive operations stay on the internal admin surface.
//
// See docs/api-v1.md.

import { GET as innerGET } from "@/app/api/shooter/[shooterId]/route";
import { forwardToInternal, gateV1Request, mapInnerToV1 } from "@/lib/api-v1";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shooterId: string }> },
) {
  const gate = await gateV1Request(req);
  if (gate instanceof Response) return gate;

  const inner = await forwardToInternal(() => innerGET(req, { params }));
  return mapInnerToV1(inner, { notFoundMessage: "Shooter not found" });
}
