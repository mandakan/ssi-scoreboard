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

  const baseUrl = new URL(request.url).origin;

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
