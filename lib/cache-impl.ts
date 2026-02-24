// Default cache implementation — Node.js / Docker builds.
// Cloudflare builds replace this module with lib/cache-edge.ts via the
// webpack alias in next.config.ts (DEPLOY_TARGET=cloudflare).
export { default } from "./cache-node";
