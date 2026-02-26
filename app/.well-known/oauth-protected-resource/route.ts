/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * MCP clients implementing the June 2025 auth spec (Claude Desktop, ChatGPT)
 * probe this endpoint before attempting the MCP handshake. A 404 here is
 * treated as a connection/auth error by those clients.
 *
 * Returning an empty `authorization_servers` array explicitly signals that
 * this is an authless server — no OAuth flow is required.
 */
export async function GET() {
  const resource =
    (process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev") + "/api/mcp";

  return Response.json(
    {
      resource,
      authorization_servers: [],
      bearer_methods_supported: [],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
