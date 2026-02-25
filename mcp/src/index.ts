import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerMcpTools } from "../../lib/mcp-tools.ts";

const baseUrl = process.env.SSI_SCOREBOARD_BASE_URL ?? "http://localhost:3000";

async function main() {
  const server = new McpServer({ name: "ssi-scoreboard", version: "0.1.0" });
  registerMcpTools(server, baseUrl);
  await server.connect(new StdioServerTransport());
}

main().catch(console.error);
