import type { NextConfig } from "next";
import path from "path";

const isCF = process.env.DEPLOY_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

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
        },
      }
    : {},

  // Webpack alias (fallback for build pipelines that use webpack mode).
  webpack(config) {
    if (isCF) {
      const edgeImpl = path.resolve(process.cwd(), "lib/cache-edge");
      config.resolve = {
        ...config.resolve,
        alias: {
          "@/lib/cache-impl": edgeImpl,
          ...(config.resolve?.alias as Record<string, string> | undefined ?? {}),
        },
      };
    }
    return config;
  },
};

export default nextConfig;
