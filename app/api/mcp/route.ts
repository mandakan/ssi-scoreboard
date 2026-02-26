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
 * GET — SSE listening stream or discovery response.
 *
 * Streamable HTTP clients (claude.ai, Claude Desktop) open a GET connection
 * to receive server-initiated events. For this stateless server there are no
 * server-initiated messages, but we must return 200 + text/event-stream so
 * the client considers the connection established. Cloudflare Workers cannot
 * maintain indefinite streams, so we send periodic keep-alive pings and let
 * the stream time out. Clients reconnect automatically per the SSE spec.
 *
 * Plain GET requests (browsers, curl without text/event-stream) return a
 * JSON discovery document.
 */
export async function GET(request: Request) {
  if (!request.headers.get("accept")?.includes("text/event-stream")) {
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

  // SSE stream — no server-initiated messages, but returning 200 prevents
  // clients from showing a "connection error". Send a ping immediately then
  // close after ~25s; the SSE auto-reconnect mechanism keeps the client live.
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout>;

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": ping\n\n"));
      // Close before CF's response timeout so the stream ends cleanly.
      timer = setTimeout(() => controller.close(), 25_000);
    },
    cancel() {
      clearTimeout(timer);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(request: Request) {
  const auth = request.headers.get("Authorization");
  const secret = process.env.MCP_SECRET;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://scoreboard.urdr.dev";

  // Always require a Bearer token so the OAuth flow is triggered correctly:
  // unauthenticated clients receive 401 with WWW-Authenticate, complete the
  // OAuth dance, then retry with the token (per RFC 9728 / MCP OAuth spec).
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    });
  }

  // If MCP_SECRET is configured, enforce it.  Otherwise accept any Bearer token
  // (public API — the token is a formality to satisfy the OAuth handshake).
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        ...CORS,
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    });
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
