// SSI GraphQL JWT manager — server-only.
//
// As of 2026-05, every SSI GraphQL resolver requires both `x-api-key` AND a
// JWT obtained via the `token_auth(email, password)` mutation. API-key-only
// access returns "User must be authenticated" on every field. See:
// https://shootnscoreit.com/about-the-api/
//
// This module owns the JWT lifecycle:
//  - Acquire on demand (cold start): refresh_token if we have one cached,
//    else token_auth(email, password).
//  - Cache in Redis (`ssi:jwt:v1`) so all worker isolates share one token —
//    avoids hammering token_auth on cold deploys / scale-out.
//  - Single-flight via a module-level promise so concurrent getJwt() calls
//    inside one isolate dedupe.
//  - Refresh-on-expired: callers signal {force:true} to skip the cache and
//    re-mint after a JWT-expiry rejection.
//
// Failure modes:
//  - Missing creds → throw at acquisition time. Surfaces at first upstream
//    request after a misconfiguration; not at module load.
//  - refresh_token failure → fall back to token_auth(email, password) once.
//  - token_auth failure → propagate the error message verbatim so operators
//    can see "invalid_credentials" / "account locked" / etc.

import cache from "@/lib/cache-impl";

const GRAPHQL_ENDPOINT = "https://shootnscoreit.com/graphql/";
const CACHE_KEY = "ssi:jwt:v1";

// Refresh tokens live ~7 days per SSI. Re-mint when <24h remain so no in-flight
// request hits an expired refresh and has to fall back to password login.
const REFRESH_RENEW_BEFORE_SECONDS = 24 * 60 * 60;

// JWTs expire faster than refresh tokens (typically ~1h). We cache them with
// a conservative TTL so the next isolate / next request picks up a fresh one
// well before SSI rejects it. The actual JWT exp claim is opaque to us.
const JWT_CACHE_TTL_SECONDS = 30 * 60;

interface CachedAuth {
  jwt: string;
  refreshToken: string;
  // ISO timestamp of refresh-token expiry, used to trigger renewal.
  refreshExpiresAt: string;
  // When this cache entry was minted (ms epoch). Used to bound JWT freshness.
  cachedAt: number;
}

interface TokenAuthResponse {
  data?: {
    token_auth?: {
      success: boolean;
      errors: unknown;
      token?: { token: string } | null;
      refresh_token?: { token: string; expires_at: string } | null;
    } | null;
  };
  errors?: { message: string }[];
}

interface RefreshTokenResponse {
  data?: {
    refresh_token?: {
      success: boolean;
      errors: unknown;
      token?: { token: string } | null;
      refresh_token?: { token: string; expires_at: string } | null;
    } | null;
  };
  errors?: { message: string }[];
}

let inflight: Promise<string> | null = null;

/**
 * Returns a JWT suitable for `Authorization: JWT <token>`.
 *
 * Pass `{force:true}` to bypass the cache and re-mint — use this after
 * an upstream call fails with a JWT-expiry GraphQL error.
 */
export async function getJwt(opts: { force?: boolean } = {}): Promise<string> {
  if (!opts.force) {
    // Single-flight within this isolate. Concurrent callers all wait on the
    // same promise so we only do one network roundtrip per cold-start burst.
    if (inflight) return inflight;
  }

  const promise = acquireJwt(opts.force ?? false).finally(() => {
    if (inflight === promise) inflight = null;
  });
  inflight = promise;
  return promise;
}

async function acquireJwt(force: boolean): Promise<string> {
  // Cache hit — happy path.
  if (!force) {
    const cached = await readCache();
    if (cached) return cached.jwt;
  }

  // No cache or forced refresh. Try refresh_token first (cheaper than login).
  const cached = await readCache();
  if (cached?.refreshToken) {
    const remainingSec = Math.floor(
      (new Date(cached.refreshExpiresAt).getTime() - Date.now()) / 1000,
    );
    if (remainingSec > REFRESH_RENEW_BEFORE_SECONDS) {
      try {
        const fresh = await refreshJwt(cached.refreshToken);
        await writeCache(fresh);
        return fresh.jwt;
      } catch (err) {
        // Refresh failed (revoked / bad token). Fall through to password login.
        console.warn(
          `[ssi-auth] refresh_token failed, falling back to token_auth: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const fresh = await loginJwt();
  await writeCache(fresh);
  return fresh.jwt;
}

async function readCache(): Promise<CachedAuth | null> {
  try {
    const raw = await cache.get(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAuth;
    if (!parsed.jwt || !parsed.refreshToken || !parsed.refreshExpiresAt) return null;
    return parsed;
  } catch (err) {
    console.warn(`[ssi-auth] cache read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function writeCache(auth: CachedAuth): Promise<void> {
  try {
    await cache.set(CACHE_KEY, JSON.stringify(auth), JWT_CACHE_TTL_SECONDS);
  } catch (err) {
    // A cache write failure is non-fatal — every request will just re-login.
    // Surface it in logs so operators notice persistent failures.
    console.warn(`[ssi-auth] cache write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loginJwt(): Promise<CachedAuth> {
  const email = process.env.SSI_SERVICE_EMAIL;
  const password = process.env.SSI_SERVICE_PASSWORD;
  const apiKey = process.env.SSI_API_KEY;
  if (!email || !password) {
    throw new Error("SSI_SERVICE_EMAIL / SSI_SERVICE_PASSWORD not configured");
  }
  if (!apiKey) {
    throw new Error("SSI_API_KEY not configured");
  }

  const body = JSON.stringify({
    query:
      "mutation Login($email: String!, $pwd: String!) { token_auth(email: $email, password: $pwd) { success errors token { token } refresh_token { token expires_at } } }",
    variables: { email, pwd: password },
  });

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`token_auth HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as TokenAuthResponse;
  if (json.errors?.length) {
    throw new Error(`token_auth GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const ta = json.data?.token_auth;
  if (!ta?.success || !ta.token?.token || !ta.refresh_token?.token) {
    const errMsg = formatAuthErrors(ta?.errors);
    throw new Error(`token_auth rejected: ${errMsg ?? "unknown"}`);
  }

  return {
    jwt: ta.token.token,
    refreshToken: ta.refresh_token.token,
    refreshExpiresAt: ta.refresh_token.expires_at,
    cachedAt: Date.now(),
  };
}

async function refreshJwt(refreshToken: string): Promise<CachedAuth> {
  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) throw new Error("SSI_API_KEY not configured");

  const body = JSON.stringify({
    query:
      "mutation Refresh($rt: String!) { refresh_token(refresh_token: $rt, revoke_refresh_token: false) { success errors token { token } refresh_token { token expires_at } } }",
    variables: { rt: refreshToken },
  });

  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`refresh_token HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as RefreshTokenResponse;
  if (json.errors?.length) {
    throw new Error(`refresh_token GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  const r = json.data?.refresh_token;
  if (!r?.success || !r.token?.token || !r.refresh_token?.token) {
    const errMsg = formatAuthErrors(r?.errors);
    throw new Error(`refresh_token rejected: ${errMsg ?? "unknown"}`);
  }
  return {
    jwt: r.token.token,
    refreshToken: r.refresh_token.token,
    refreshExpiresAt: r.refresh_token.expires_at,
    cachedAt: Date.now(),
  };
}

function formatAuthErrors(errors: unknown): string | null {
  if (!errors) return null;
  // SSI returns either a list or a dict like { nonFieldErrors: [{message,code}] }.
  try {
    return JSON.stringify(errors);
  } catch {
    return String(errors);
  }
}

/**
 * GraphQL error messages from SSI that mean "your JWT is no longer accepted".
 * Used by lib/graphql.ts to decide whether to refresh + retry once.
 */
export const JWT_EXPIRED_ERROR_PATTERNS = [
  "Signature has expired",
  "Error decoding signature",
  "Invalid token",
  // SSI also surfaces unauthenticated errors as "User must be authenticated"
  // when the JWT is missing/rejected — covered so a stale cached token
  // (e.g. after a backend restart) recovers on the next request.
  "User must be authenticated",
];

/** Test-only reset — clears the in-isolate single-flight promise. */
export function __resetForTests(): void {
  inflight = null;
}
