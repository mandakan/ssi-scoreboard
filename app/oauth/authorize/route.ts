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

  // Basic open-redirect mitigation: only allow HTTPS callbacks.
  // No user secrets are at stake (public server), but good practice.
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(redirectUri);
    if (callbackUrl.protocol !== "https:") throw new Error("HTTPS only");
  } catch {
    return new Response("Invalid redirect_uri — must be an HTTPS URL", { status: 400 });
  }

  // Auto-approve: generate a one-time code and redirect immediately.
  callbackUrl.searchParams.set("code", crypto.randomUUID());
  if (state) callbackUrl.searchParams.set("state", state);

  return Response.redirect(callbackUrl.toString(), 302);
}
