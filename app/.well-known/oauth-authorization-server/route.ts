/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * MCP clients that found our oauth-protected-resource metadata follow up here
 * to discover our authorization endpoints. We expose a minimal OAuth server
 * that auto-approves all requests — this is a fully public read-only API with
 * no user accounts or private data.
 */
const CORS = { "Access-Control-Allow-Origin": "*" };

export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev";
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [],
    },
    { headers: CORS },
  );
}
