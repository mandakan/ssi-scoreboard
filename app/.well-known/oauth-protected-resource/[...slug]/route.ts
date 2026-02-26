/**
 * OAuth 2.0 Protected Resource Metadata — resource-specific path (RFC 9728).
 *
 * Per RFC 9728 §3, clients SHOULD look up protected-resource metadata at
 * /.well-known/oauth-protected-resource/{resource-path} before falling back
 * to the bare /.well-known/oauth-protected-resource URL.
 *
 * For our MCP server at /api/mcp, Claude and other clients probe
 * /.well-known/oauth-protected-resource/api/mcp first. This catch-all
 * returns the same metadata as the parent route so the resource-specific
 * lookup succeeds immediately (no 404 fallback needed).
 */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev";
  return Response.json(
    {
      resource: `${base}/api/mcp`,
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
