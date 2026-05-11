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
    !Array.isArray(body)
  ) {
    // Service-account authorization metadata is internal-only: it answers
    // "why did SSI return us data on this match" and only makes sense in
    // the context of our bot account. Strip from the v1 surface so external
    // consumers (e.g. splitsmith) aren't coupled to our auth model. If a
    // future consumer needs `organizer`, expose it as an optional v1 field
    // in a follow-up rather than leaking the whole envelope.
    const {
      scoring_pct,
      access_reason: _accessReason,
      role_names: _roleNames,
      organizer: _organizer,
      ...rest
    } = body as {
      scoring_pct?: number;
      access_reason?: unknown;
      role_names?: unknown;
      organizer?: unknown;
    } & Record<string, unknown>;
    void _accessReason;
    void _roleNames;
    void _organizer;
    const remapped: Record<string, unknown> =
      typeof scoring_pct === "number"
        ? { ...rest, scoring_completed: scoring_pct }
        : rest;
    const headers = new Headers(mapped.headers);
    headers.delete("Content-Length");
    return new Response(JSON.stringify(remapped), {
      status: mapped.status,
      headers,
    });
  }
  return mapped;
}
