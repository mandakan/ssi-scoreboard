/**
 * OAuth 2.0 Authorization Endpoint.
 *
 * Auto-approves all requests and redirects immediately — no user sign-in
 * required because this is a fully public read-only API. The browser
 * redirect will be nearly instant.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");

  if (!redirectUri) {
    return new Response("Missing redirect_uri", { status: 400 });
  }

  // Open-redirect mitigation: allow HTTPS callbacks for web clients, and
  // http://localhost / http://127.0.0.1 for native/CLI MCP clients that spin
  // up a local callback server (RFC 8252 §7.3). Block all other HTTP URLs.
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(redirectUri);
    const isHttps = callbackUrl.protocol === "https:";
    const isLocalhost =
      callbackUrl.protocol === "http:" &&
      (callbackUrl.hostname === "localhost" || callbackUrl.hostname === "127.0.0.1");
    if (!isHttps && !isLocalhost) throw new Error("HTTPS or localhost only");
  } catch {
    return new Response("Invalid redirect_uri — must be HTTPS or http://localhost", {
      status: 400,
    });
  }

  // Auto-approve: generate a one-time code and redirect immediately.
  // Echo scope back per RFC 6749 §4.1.2 so clients that validate granted
  // scopes (e.g. claude.ai requires scope=claudeai) don't reject the grant.
  callbackUrl.searchParams.set("code", crypto.randomUUID());
  if (state) callbackUrl.searchParams.set("state", state);
  const scope = searchParams.get("scope");
  if (scope) callbackUrl.searchParams.set("scope", scope);

  return Response.redirect(callbackUrl.toString(), 302);
}
