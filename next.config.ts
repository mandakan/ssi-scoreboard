import type { NextConfig } from "next";
import path from "path";

const isCF = process.env.DEPLOY_TARGET === "cloudflare";

const nextConfig: NextConfig = {
  // "standalone" is required for Docker multi-stage builds.
  // Cloudflare Pages uses @cloudflare/next-on-pages and needs no output mode set.
  output: isCF ? undefined : "standalone",

  webpack(config) {
    if (isCF) {
      // Replace the default Node.js cache adapter with the edge (Upstash) adapter
      // so that ioredis is never bundled into the Cloudflare Worker.
      // The more-specific alias is placed first so it takes precedence over the
      // existing "@" path alias that Next.js registers.
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
