import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { NextResponse } from "next/server";
import { registerMcpTools } from "@/lib/mcp-tools";

/**
 * Minimal single-request/response transport for Next.js App Router.
 * The MCP SDK's StreamableHTTPServerTransport uses Node.js HTTP internals;
 * this lightweight shim handles one JSON-RPC call per POST request.
 */
class SingleShotTransport implements Transport {
  onmessage?: (msg: JSONRPCMessage) => void;
  onerror?: (err: Error) => void;
  onclose?: () => void;

  private _sent: JSONRPCMessage[] = [];

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(msg: JSONRPCMessage): Promise<void> {
    this._sent.push(msg);
  }

  flush(): JSONRPCMessage[] {
    return this._sent;
  }

  deliver(msg: JSONRPCMessage): void {
    this.onmessage?.(msg);
  }
}

/**
 * GET — server discovery / human-readable landing page.
 * MCP clients probe with GET before issuing POST calls; browsers also hit GET.
 */
export async function GET() {
  return NextResponse.json({
    name: "ssi-scoreboard",
    version: "0.1.0",
    description: "MCP server for SSI Scoreboard — query IPSC competition data via Claude or any MCP-compatible client.",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    tools: ["search_events", "get_match", "compare_competitors", "get_popular_matches"],
  });
}

export async function POST(request: Request) {
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let body: JSONRPCMessage;
  try {
    body = (await request.json()) as JSONRPCMessage;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Use an explicit env var rather than request.url to avoid SSRF — the Host
  // header can be spoofed, which would taint request.url. The MCP tools only
  // ever call this app's own API endpoints, so localhost is always correct for
  // same-server deployments. Set NEXT_PUBLIC_APP_URL to override (e.g. for CF
  // Pages where localhost calls are not available).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  const transport = new SingleShotTransport();
  const server = new McpServer({ name: "ssi-scoreboard", version: "0.1.0" });
  registerMcpTools(server, baseUrl);
  await server.connect(transport);

  // Deliver the incoming JSON-RPC message to the server
  transport.deliver(body);

  // Yield to allow async handlers to complete
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const messages = transport.flush();
  if (messages.length === 0) {
    return NextResponse.json({ error: "No response from server" }, { status: 500 });
  }
  return NextResponse.json(messages[0]);
}
