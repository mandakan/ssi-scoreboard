/**
 * OAuth 2.0 Token Endpoint.
 *
 * Issues a long-lived bearer token for any valid-looking request.
 * The MCP server at /api/mcp ignores the bearer token (no MCP_SECRET
 * configured), so the token is effectively a formality — it just
 * satisfies the client's OAuth flow requirement.
 */
const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  // Echo the requested scope back per RFC 6749 §5.1 so clients (e.g.
  // claude.ai) that validate the granted scope don't reject the token.
  let scope = "";
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const body = new URLSearchParams(await request.text());
      scope = body.get("scope") ?? "";
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      scope = typeof body.scope === "string" ? body.scope : "";
    }
  } catch { /* ignore — scope is optional */ }

  return Response.json(
    {
      access_token: crypto.randomUUID(),
      token_type: "Bearer",
      // 1-year expiry — avoids frequent re-auth prompts for a public API.
      expires_in: 365 * 24 * 3600,
      ...(scope ? { scope } : {}),
    },
    { headers: CORS },
  );
}
