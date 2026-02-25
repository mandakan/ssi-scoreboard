// Server-only — registers MCP tools on a McpServer instance.
// Called by both the HTTP route handler and the stdio server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventSummary, MatchResponse, CompareResponse, PopularMatch } from "./types";

async function apiFetch<T>(baseUrl: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}${path}`);
  return res.json() as Promise<T>;
}

export function registerMcpTools(server: McpServer, baseUrl: string): void {
  server.tool(
    "search_events",
    "Search IPSC events. Returns list with id, content_type, name, venue, date, level. " +
    "Pass ct+id from results to get_match.",
    {
      query: z.string().optional().describe("Free-text search"),
      min_level: z.enum(["all", "l2plus", "l3plus", "l4plus"]).optional()
        .describe("Defaults to l2plus (hides Level I club matches)"),
      country: z.string().length(3).optional().describe("ISO 3166-1 alpha-3, e.g. SWE"),
      starts_after: z.string().optional().describe("ISO date, e.g. 2025-01-01"),
      starts_before: z.string().optional().describe("ISO date, e.g. 2025-12-31"),
    },
    async (input) => {
      const p = new URLSearchParams();
      if (input.query) p.set("q", input.query);
      if (input.min_level) p.set("minLevel", input.min_level);
      if (input.country) p.set("country", input.country);
      if (input.starts_after) p.set("starts_after", input.starts_after);
      if (input.starts_before) p.set("starts_before", input.starts_before);
      const data = await apiFetch<EventSummary[]>(baseUrl, `/api/events?${p}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_match",
    "Fetch match details: name, venue, date, stage list, competitor list with IDs. " +
    "Use competitor IDs with compare_competitors.",
    {
      ct: z.string().describe("Content type (e.g. '22' for IPSC matches)"),
      id: z.string().describe("Match ID"),
    },
    async ({ ct, id }) => {
      const data = await apiFetch<MatchResponse>(baseUrl, `/api/match/${ct}/${id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "compare_competitors",
    "Deep stage-by-stage comparison for 1–12 competitors. Returns per-stage breakdown, " +
    "penalty stats, efficiency, consistency, loss breakdown, what-if simulations, " +
    "and style fingerprint. Use competitor IDs from get_match.",
    {
      ct: z.string().describe("Content type"),
      id: z.string().describe("Match ID"),
      competitor_ids: z.array(z.number().int().positive()).min(1).max(12)
        .describe("1–12 competitor IDs"),
    },
    async ({ ct, id, competitor_ids }) => {
      const data = await apiFetch<CompareResponse>(
        baseUrl,
        `/api/compare?ct=${ct}&id=${id}&competitor_ids=${competitor_ids.join(",")}`,
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_popular_matches",
    "Recently accessed matches from cache. Good starting point for finding active events. " +
    "Returns [] if Redis cache is unavailable.",
    {},
    async () => {
      const data = await apiFetch<PopularMatch[]>(baseUrl, "/api/popular-matches");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
