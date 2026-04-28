import type { NextConfig } from "next";
import path from "path";

const isCF = process.env.DEPLOY_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  // "standalone" is required for Docker multi-stage builds.
  // Cloudflare Pages uses @cloudflare/next-on-pages and needs no output mode set.
  output: isCF ? undefined : "standalone",

  // Turbopack alias (Next.js 16+ default build pipeline).
  // An empty object for non-CF builds satisfies Next.js's requirement that a
  // turbopack config be present whenever a webpack config is also defined.
  turbopack: isCF
    ? {
        resolveAlias: {
          // Replace the default Node.js cache adapter with the Upstash HTTP
          // adapter so that ioredis is never bundled into the Cloudflare Worker.
          "@/lib/cache-impl": "@/lib/cache-edge",
          // Replace the default SQLite shooter store with the D1 adapter
          // so that better-sqlite3 is never bundled into the Cloudflare Worker.
          "@/lib/db-impl": "@/lib/db-d1",
          // Replace the no-op background scheduler with the CF waitUntil
          // implementation so D1 writes complete after the response is sent.
          "@/lib/background-impl": "@/lib/background-cf",
          // Register the R2 NDJSON telemetry sink on CF; Docker has no
          // extra sinks beyond the always-on console sink.
          "@/lib/telemetry-sinks-impl": "@/lib/telemetry-sinks-cf",
        },
      }
    : {},

  // Security headers applied to all responses.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // HSTS: ignored over HTTP, so safe to set unconditionally.
          // 2-year max-age is the recommended value for preload-list eligibility.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },

  // Webpack alias (fallback for build pipelines that use webpack mode).
  // Exclude better-sqlite3 native addon from server-side bundling.
  serverExternalPackages: ["better-sqlite3"],

  webpack(config) {
    if (isCF) {
      const edgeImpl = path.resolve(process.cwd(), "lib/cache-edge");
      const d1Impl = path.resolve(process.cwd(), "lib/db-d1");
      const bgCf = path.resolve(process.cwd(), "lib/background-cf");
      const telemetryCf = path.resolve(process.cwd(), "lib/telemetry-sinks-cf");
      config.resolve = {
        ...config.resolve,
        alias: {
          "@/lib/cache-impl": edgeImpl,
          "@/lib/db-impl": d1Impl,
          "@/lib/background-impl": bgCf,
          "@/lib/telemetry-sinks-impl": telemetryCf,
          ...(config.resolve?.alias as Record<string, string> | undefined ?? {}),
        },
      };
    }
    return config;
  },
};

export default nextConfig;
