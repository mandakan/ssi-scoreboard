import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { NextResponse } from "next/server";
import { registerMcpTools } from "@/lib/mcp-tools";

/**
 * Promise-based single-request/response transport for Next.js App Router.
 *
 * Unlike the old flush/setTimeout approach, waitForResponse() properly awaits
 * the server's async send() call — so tool handlers that make fetch() requests
 * complete before we return to the client.
 */
class SingleShotTransport implements Transport {
  onmessage?: (msg: JSONRPCMessage) => void;
  onerror?: (err: Error) => void;
  onclose?: () => void;

  private _resolve?: (msg: JSONRPCMessage) => void;
  private readonly _responsePromise: Promise<JSONRPCMessage>;

  constructor() {
    this._responsePromise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(msg: JSONRPCMessage): Promise<void> {
    this._resolve?.(msg);
  }

  waitForResponse(timeoutMs = 30_000): Promise<JSONRPCMessage | null> {
    return Promise.race([
      this._responsePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  deliver(msg: JSONRPCMessage): void {
    this.onmessage?.(msg);
  }
}

// CORS headers — needed for browser-context MCP clients (e.g. web-based AI assistants).
const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Pre-flight CORS request from browser clients. */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * GET — server discovery or SSE listening mode.
 *
 * Clients that send Accept: text/event-stream are expecting either the old
 * SSE transport or Streamable HTTP server-push mode — neither is possible on
 * stateless Cloudflare Workers. Per the Streamable HTTP spec, returning 405
 * tells well-behaved clients (including the MCP SDK) to fall back to
 * POST-only request/response mode.
 *
 * Plain GET requests (browsers, curl) get a JSON discovery response.
 */
export async function GET(request: Request) {
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return new Response("SSE transport not supported — use POST", {
      status: 405,
      headers: { ...CORS, Allow: "POST" },
    });
  }

  return NextResponse.json(
    {
      name: "ssi-scoreboard",
      version: "0.1.0",
      description:
        "MCP server for SSI Scoreboard — query IPSC competition data via Claude or any MCP-compatible client.",
      transport: "streamable-http",
      endpoint: "/api/mcp",
      tools: ["search_events", "get_match", "compare_competitors", "get_popular_matches"],
    },
    { headers: CORS },
  );
}

export async function POST(request: Request) {
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }
  }

  let body: JSONRPCMessage;
  try {
    body = (await request.json()) as JSONRPCMessage;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  // Use an explicit env var rather than request.url to avoid SSRF — the Host
  // header can be spoofed, which would taint request.url. The MCP tools only
  // ever call this app's own API endpoints, so localhost is always correct for
  // same-server deployments. Set NEXT_PUBLIC_APP_URL to override (e.g. for CF
  // Pages where localhost calls are not available).
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

  const transport = new SingleShotTransport();
  const server = new McpServer({ name: "ssi-scoreboard", version: "0.1.0" });
  registerMcpTools(server, baseUrl);
  await server.connect(transport);

  // JSON-RPC notifications have no `id` field (e.g. notifications/initialized).
  // They don't expect a response — acknowledge with 202 so clients don't treat
  // the missing body as an error.
  if (!("id" in body)) {
    transport.deliver(body);
    return new Response(null, { status: 202, headers: CORS });
  }

  // Deliver the request and wait for the server's async response. Using a
  // proper Promise (resolved when send() fires) rather than setTimeout(0) so
  // that tool handlers which call fetch() have time to complete.
  transport.deliver(body);
  const response = await transport.waitForResponse(30_000);
  if (response === null) {
    return NextResponse.json(
      { error: "No response from server" },
      { status: 500, headers: CORS },
    );
  }
  return NextResponse.json(response, { headers: CORS });
}
