// Default AppDatabase implementation — SQLite (Node.js / Docker builds).
// Cloudflare builds replace this module with lib/db-d1.ts via the
// webpack/turbopack alias in next.config.ts (DEPLOY_TARGET=cloudflare).
export { default } from "./db-sqlite";
