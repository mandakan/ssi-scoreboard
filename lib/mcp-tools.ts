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
    "Search for IPSC competitions by name, country, date range, or level. " +
    "Use this to find a specific match the user has named, or to browse upcoming/recent events. " +
    "Each result contains `id` and `content_type` fields — pass both to get_match to load full details. " +
    "Omit all filters to list upcoming events. " +
    "`min_level` defaults to l2plus which hides small club matches; pass 'all' only if the user explicitly wants club-level events.",
    {
      query: z.string().optional().describe("Free-text search by event name or venue"),
      min_level: z.enum(["all", "l2plus", "l3plus", "l4plus"]).optional()
        .describe("Minimum competition level. Defaults to l2plus (Regional and above). Use 'all' to include Level I club matches."),
      country: z.string().length(3).optional().describe("ISO 3166-1 alpha-3 country code, e.g. SWE, NOR, FIN"),
      starts_after: z.string().optional().describe("Only return events starting on or after this date. ISO format: YYYY-MM-DD"),
      starts_before: z.string().optional().describe("Only return events starting on or before this date. ISO format: YYYY-MM-DD"),
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
    "Fetch full details for a specific IPSC match. " +
    "Returns the complete competitor list — each entry has a numeric `id`, `name`, `club`, and `division`. " +
    "Also returns a `squads` list where each squad has a `name` (e.g. 'Squad 3') and a `competitorIds` array of every competitor in that squad. " +
    "Use this to resolve any user reference to a competitor ID before calling compare_competitors: " +
    "match by `name` for named individuals, filter by `club` for club members, or use `squads[n].competitorIds` for an entire squad. " +
    "Always call this before compare_competitors. " +
    "`ct` and `id` come from a search_events result (the `content_type` and `id` fields of the event).",
    {
      ct: z.string().describe("content_type value from a search_events result (typically '22' for IPSC matches)"),
      id: z.string().describe("id value from a search_events result"),
    },
    async ({ ct, id }) => {
      const data = await apiFetch<MatchResponse>(baseUrl, `/api/match/${ct}/${id}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "compare_competitors",
    "Run a deep stage-by-stage comparison for 1–12 competitors in a match. " +
    "Returns scores, hit factors, penalties, efficiency %, consistency, time-vs-accuracy breakdown, what-if rank simulations, and performance fingerprints. " +
    "Pass a single competitor ID to analyse one shooter in isolation. " +
    "Pass multiple IDs to compare them head-to-head across every stage. " +
    "`competitor_ids` are numeric IDs from get_match's competitor list — always resolve names to IDs via get_match first. " +
    "Results are suitable for natural-language coaching feedback, identifying where points were lost, and ranking analysis.",
    {
      ct: z.string().describe("content_type value from the search_events result for this match"),
      id: z.string().describe("id value from the search_events result for this match"),
      competitor_ids: z.array(z.number().int().positive()).min(1).max(12)
        .describe("Numeric competitor IDs from get_match. Up to 12. Resolve names to IDs with get_match before calling this."),
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
    "List recently-viewed IPSC matches from the cache. " +
    "Call this first whenever the user hasn't specified a match — it surfaces currently-active or recently-popular events so you can ask which one they mean, or proceed with the most relevant one. " +
    "If the user asks a vague question like 'how did I do?' or 'what matches are on?', start here. " +
    "Returns [] when the cache is cold (no recent visitors); fall back to search_events in that case.",
    {},
    async () => {
      const data = await apiFetch<PopularMatch[]>(baseUrl, "/api/popular-matches");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
