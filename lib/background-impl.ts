// Default background-work implementation — Node.js / Docker builds.
// Cloudflare builds replace this module with lib/background-cf.ts via the
// webpack/turbopack alias in next.config.ts (DEPLOY_TARGET=cloudflare).
export { afterResponse } from "./background";
