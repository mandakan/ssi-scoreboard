import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerMcpTools } from "../../lib/mcp-tools.ts";

const PROD_URL = "https://scoreboard.urdr.dev";

/**
 * Smithery configSchema.
 * All fields are optional — the server connects to the public scoreboard API by
 * default, but operators running a self-hosted instance can override the URL.
 */
export const configSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "Base URL of the SSI Scoreboard instance. Defaults to https://scoreboard.urdr.dev",
    ),
});

/**
 * Smithery entry point (runtime: typescript).
 * Called by Smithery's HTTP runtime on each request.
 */
export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {
  const server = new McpServer({ name: "ssi-scoreboard", version: "0.1.0" });
  registerMcpTools(server, config.baseUrl ?? PROD_URL);
  return server.server;
}

// ---------------------------------------------------------------------------
// Stdio shim — used by the local .mcp.json entry and Claude Desktop.
// Only runs when this file is the process entry point, not when imported
// by Smithery's HTTP runtime bundler.
// ---------------------------------------------------------------------------
async function main() {
  const baseUrl = process.env.SSI_SCOREBOARD_BASE_URL ?? PROD_URL;
  const server = new McpServer({ name: "ssi-scoreboard", version: "0.1.0" });
  registerMcpTools(server, baseUrl);
  await server.connect(new StdioServerTransport());
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(console.error);
}
