import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// NOTE: Next.js 16 renamed this file convention from "middleware" to "proxy",
// but @opennextjs/cloudflare does not yet support the new Node.js-runtime proxy
// convention. We keep the deprecated middleware.ts name so Cloudflare builds
// continue to work. Revisit once @opennextjs/cloudflare adds proxy support.
export function middleware(request: NextRequest) {
  // Generate a per-request cryptographic nonce (Web Crypto API — works in both
  // Node.js and Cloudflare Workers edge runtime).
  const nonce = btoa(crypto.randomUUID());

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets trusted nonce-carrying scripts (Next.js bootstrap,
    // next-themes inline script) load additional chunks without per-chunk nonces.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Inline styles are required by Tailwind utility classes and component
    // libraries that write style attributes at runtime.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Forward the nonce to server components via a request header so that
  // layout.tsx can read it and pass it to ThemeProvider / next/script.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

// Run on all routes except Next.js internals and static files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
