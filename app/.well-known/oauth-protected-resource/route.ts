/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * MCP clients implementing the June 2025 auth spec (Claude Desktop, ChatGPT)
 * probe this endpoint before attempting the MCP handshake. We point them at
 * our own OAuth server (same origin), which auto-approves all requests since
 * this is a fully public read-only API.
 */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev";
  return Response.json(
    {
      resource: `${base}/api/mcp`,
      // Points to our own authorization server — clients will follow up at
      // /.well-known/oauth-authorization-server to get the OAuth endpoints.
      authorization_servers: [base],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
