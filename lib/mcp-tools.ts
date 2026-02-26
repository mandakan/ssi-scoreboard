// Server-only — registers MCP tools, resources, and prompts on a McpServer instance.
// Called by both the HTTP route handler and the stdio server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventSummary, MatchResponse, CompareResponse, PopularMatch } from "./types";

// ---------------------------------------------------------------------------
// Static resource content
// ---------------------------------------------------------------------------

const GUIDE_TEXT = `\
SSI Scoreboard MCP Server — Tool Guide
=======================================

This server provides read-only access to IPSC competition data from
ShootNScoreIt (SSI) via the public scoreboard at https://scoreboard.urdr.dev.

TYPICAL WORKFLOWS
-----------------

1. Analyse one competitor's performance:
   search_events(query="<match name>")
   → get_match(ct, id)
   → compare_competitors(ct, id, [competitor_id])

2. Compare a squad head-to-head:
   search_events(...)
   → get_match(...)         ← use squads[n].competitorIds to find IDs
   → compare_competitors(ct, id, ids)

3. Browse currently popular / active matches:
   get_popular_matches()    ← returns [] when cache cold
   → (if empty) search_events(starts_after="<today>")

TOOL SUMMARY
------------

search_events
  Find events by name, country, date range, or competition level.
  • min_level defaults to "l2plus" (Regional and above).
    Use "all" only when the user explicitly asks for Level I club matches.
  • With a query param, past events are included — no date filter needed.
  • Without a query, returns events within ~3 months of today.

get_match
  Load full competitor list, stage list, and squads for one match.
  • Always call this before compare_competitors to resolve names → numeric IDs.
  • squads[n].competitorIds lists every approved competitor in that squad.
  • scoring_completed (0–100 %) shows how much of the match has been scored.

compare_competitors
  Deep stage-by-stage analysis for 1–12 competitors.
  • Pass a single ID for solo analysis; multiple IDs for head-to-head.
  • Returns: scores, hit factors, penalties, efficiency, consistency,
    what-if rank simulations, and style fingerprints.
  • competitor_ids are numeric — always resolve names via get_match first.

get_popular_matches
  Returns recently-viewed matches from the server cache.
  • Call first when the user has not named a specific match.
  • Falls back to search_events when the cache is cold (returns []).

DATA QUALITY NOTES
------------------
• During active matches some stages may not yet be scored
  (incomplete=true, hit_factor=null).
• Competitors with dnf=true or dq=true should be noted in summaries.
• division values are lowercase strings (e.g. "production", "open").
• All percentages in compare_competitors are relative to the selected
  group leader unless the field includes "div_" or "overall_" prefix.
`;

const IPSC_REFERENCE_TEXT = `\
IPSC Reference — Divisions, Levels, and Scoring
================================================

HANDGUN DIVISIONS
-----------------
Production        Standard factory pistol, box-standard sights, 10-round limit
Production Optics Production-legal pistol with red dot sight
Standard          Modified pistol, open sights or red dot, 15-round limit
Open              Race guns, compensators, optical sights, extended magazines
Classic           1911-style single-stack pistols, 8-round limit
Revolver          Double-action revolvers, 6-round capacity

PCC DIVISIONS
-------------
PCC Optics        Pistol-calibre carbine with red dot or scope
PCC Iron          Pistol-calibre carbine with iron sights

MATCH LEVELS
------------
Level I   (L1)  Club match — local, unofficial, not in world rankings
Level II  (L2)  Regional championship
Level III (L3)  National championship
Level IV  (L4)  Continental championship (European, Pan-American, etc.)
Level V   (L5)  World Shoot — IPSC world championship

MATCH STATUS CODES (from search_events / get_match)
----------------------------------------------------
on    Ongoing / in progress
cp    Complete (results published)
dr    Draft
cs    Cancelled or suspended
pr    Pre-match (registration open, not yet running)
ol    Offline

SCORING ZONES
-------------
A   5 points   (Alpha — centre zone; hardest to hit)
C   3 points   (Charlie — outer scoring zone; B-zone combined here)
D   1 point    (Delta — edge of cardboard target)
M  −10 points  Miss (no valid zone hit on a required target)
NS −10 points  No-Shoot (hit on a non-threat / hostage target)
PE −10 points  Procedural error (per infraction)

HIT FACTOR FORMULA
------------------
  HF = total_points / total_time_in_seconds

Stage score % = (competitor_HF / stage_winner_HF) × 100

Match result = average stage % across all stages (equally weighted).
A 100 % on every stage is a perfect match.

ACCURACY vs. SPEED TRADE-OFF
-----------------------------
A-ratio = total_A / (total_A + total_C + total_D)
  • 0.80+ is excellent accuracy; typical club shooters are 0.55–0.70.
  • Shooting faster almost always produces more C/D hits, but the HF
    improves when the time savings exceed the point cost.

HIT LOSS     Points left on the table from non-A hits (C/D/miss)
             relative to a perfect alpha run.
PENALTY LOSS Points lost to M/NS/PE penalties.
PENALTY COST % = hypothetical penalty-free avg % − actual avg %.

SHOOTER ARCHETYPES (style fingerprint)
---------------------------------------
Gunslinger   High speed, lower accuracy — wins on time
Surgeon      High accuracy (A-ratio), slower — wins on points quality
Speed Demon  Fast and penalised — speed without discipline
Grinder      Steady, consistent performer near field median
`;

// ---------------------------------------------------------------------------
// Tool, resource, and prompt registration
// ---------------------------------------------------------------------------

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
    "When searching by name (query param), past events are included automatically — no date filter needed. " +
    "When browsing without a query, only events within ~3 months of today are returned by default; " +
    "pass explicit starts_after/starts_before to widen the window. " +
    "`min_level` defaults to l2plus which hides small club matches; pass 'all' only if the user explicitly wants club-level events.",
    {
      query: z.string().optional().describe("Free-text search by event name or venue"),
      min_level: z.enum(["all", "l2plus", "l3plus", "l4plus"]).optional()
        .describe("Minimum competition level. Defaults to l2plus (Regional and above). Use 'all' to include Level I club matches."),
      country: z.string().length(3).optional().describe("ISO 3166-1 alpha-3 country code, e.g. SWE, NOR, FIN"),
      starts_after: z.string().optional().describe("Only return events starting on or after this date. ISO format: YYYY-MM-DD"),
      starts_before: z.string().optional().describe("Only return events starting on or before this date. ISO format: YYYY-MM-DD"),
    },
    { readOnlyHint: true, openWorldHint: true },
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
    { readOnlyHint: true, openWorldHint: true },
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
    { readOnlyHint: true, openWorldHint: true },
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
    { readOnlyHint: true, openWorldHint: true },
    async () => {
      const data = await apiFetch<PopularMatch[]>(baseUrl, "/api/popular-matches");
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  // -------------------------------------------------------------------------
  // Resources — static reference documents readable by MCP clients
  // -------------------------------------------------------------------------

  server.resource(
    "guide",
    "ssi://guide",
    { description: "How to use the SSI Scoreboard MCP tools, including workflows and data quality notes", mimeType: "text/plain" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: GUIDE_TEXT }],
    }),
  );

  server.resource(
    "ipsc-reference",
    "ssi://ipsc-reference",
    { description: "IPSC reference: divisions, match levels, status codes, scoring zones, hit factor formula, and shooter archetypes", mimeType: "text/plain" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: IPSC_REFERENCE_TEXT }],
    }),
  );

  // -------------------------------------------------------------------------
  // Prompts — workflow starters that guide an AI through common tasks
  // -------------------------------------------------------------------------

  server.prompt(
    "analyze_performance",
    "Analyse a competitor's stage-by-stage performance at an IPSC match and produce coaching feedback",
    {
      match_name: z.string().describe("Name of the IPSC match (partial name is fine)"),
      competitor_name: z.string().describe("Full or partial name of the competitor to analyse"),
    },
    ({ match_name, competitor_name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please analyse ${competitor_name}'s performance at "${match_name}".\n\n` +
              `Steps:\n` +
              `1. Use search_events with query="${match_name}" to find the match.\n` +
              `2. Use get_match with the ct and id from that result to load competitors and stages.\n` +
              `3. Find ${competitor_name} in the competitor list — match by name.\n` +
              `4. Use compare_competitors with their numeric competitor ID.\n` +
              `5. Present a coaching summary covering:\n` +
              `   • Overall result, division rank, and overall rank\n` +
              `   • Best and worst stages (by group %)\n` +
              `   • Consistency score and what it means\n` +
              `   • Hit quality vs speed trade-off (A-ratio, efficiency)\n` +
              `   • Penalty analysis (cost in match % terms)\n` +
              `   • What-if simulation: what rank would they have achieved with a better worst stage?\n` +
              `   • 2–3 specific, actionable improvement tips`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "compare_squad",
    "Compare all members of a squad (or a named group) head-to-head at an IPSC match",
    {
      match_name: z.string().describe("Name of the IPSC match"),
      squad: z
        .string()
        .optional()
        .describe(
          "Squad name or number (e.g. 'Squad 3'). If omitted, list available squads and ask the user to choose.",
        ),
    },
    ({ match_name, squad }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please compare the competitors in ${squad ? `"${squad}"` : "a squad"} at "${match_name}".\n\n` +
              `Steps:\n` +
              `1. Use search_events with query="${match_name}" to find the match.\n` +
              `2. Use get_match to load the full competitor list and squads.\n` +
              (squad
                ? `3. Find "${squad}" in the squads list and collect all competitorIds.\n`
                : `3. List the available squads and ask the user which one to compare.\n`) +
              `4. Use compare_competitors with those competitor IDs (up to 12).\n` +
              `5. Summarise:\n` +
              `   • Head-to-head rankings within the squad\n` +
              `   • Strongest stage performance(s) and who delivered them\n` +
              `   • Who is the most consistent vs the most variable\n` +
              `   • Any standout penalty issues\n` +
              `   • A brief narrative on the overall squad dynamic`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "find_matches",
    "Find upcoming or recent IPSC matches, optionally filtered by country, name, or competition level",
    {
      query: z.string().optional().describe("Match name or venue to search for"),
      country: z
        .string()
        .optional()
        .describe("ISO 3166-1 alpha-3 country code, e.g. SWE, NOR, FIN, GBR"),
      level: z
        .enum(["all", "l2plus", "l3plus", "l4plus"])
        .optional()
        .describe("Minimum match level filter. Defaults to l2plus (Regional and above)."),
    },
    ({ query, country, level }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please find IPSC matches` +
              (query ? ` matching "${query}"` : "") +
              (country ? ` in country ${country}` : "") +
              (level && level !== "l2plus" ? ` at level ${level}` : "") +
              `.\n\n` +
              `Use search_events` +
              (query ? ` with query="${query}"` : "") +
              (country ? ` and country="${country}"` : "") +
              (level ? ` and min_level="${level}"` : "") +
              `.\n\n` +
              `Summarise the results in a table or list with: name, date, venue, level, and status ` +
              `(ongoing / complete / upcoming). Highlight any matches that are currently in progress.`,
          },
        },
      ],
    }),
  );
}
