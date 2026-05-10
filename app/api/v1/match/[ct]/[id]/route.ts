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
  const mapped = await mapInnerToV1(inner, { notFoundMessage: "Match not found" });

  // Preserve the v1 contract: the v1 surface keeps the legacy
  // `scoring_completed` field name. Internally the field was renamed to
  // `scoring_pct` to match its semantic (a percentage, not a boolean) --
  // see lib/types.ts. The wrapper re-maps so external consumers don't see
  // the rename. Within v1 only additive changes are allowed; this glue is
  // what lets internal cleanup happen without bumping to v2.
  if (!mapped.ok) return mapped;
  let body: unknown;
  try {
    body = await mapped.clone().json();
  } catch {
    return mapped;
  }
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "scoring_pct" in body
  ) {
    const { scoring_pct, ...rest } = body as { scoring_pct: number } & Record<string, unknown>;
    const remapped = { ...rest, scoring_completed: scoring_pct };
    const headers = new Headers(mapped.headers);
    headers.delete("Content-Length");
    return new Response(JSON.stringify(remapped), {
      status: mapped.status,
      headers,
    });
  }
  return mapped;
}
