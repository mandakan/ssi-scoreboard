// Server-only — registers MCP tools, resources, and prompts on a McpServer instance.
// Called by both the HTTP route handler and the stdio server.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventSummary, MatchResponse, CompareResponse, PopularMatch, ShooterDashboardResponse, ShooterSearchResult } from "./types";

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

1. Analyse one competitor's performance at a single match:
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

4. Pre-match preparation (scoring_completed = 0, match in the future):
   search_events(query="<match name>")
   → get_match(ct, id)
   stages[] now includes: procedure, firearm_condition, course_display,
   min_rounds, paper_targets, steel_targets.
   Use these to:
   • Compute the IPSC round-robin rotation for a given squad number:
       stage_index = ((squad_number − 1) + (round − 1)) % total_stages
     Where stages are sorted by stage_number (1-indexed).
   • Parse constraint signals from text fields:
       procedure:         /strong hand/i, /weak hand/i, /moving target/i
       firearm_condition: /empty|unloaded/i  → unloaded start
   • Summarise by course-length breakdown and total rounds.
   → get_shooter_dashboard(shooter_id) to add historical context
     (overall match %, trend, penalty rate) for personalised prep advice.

5. Cross-competition profile for a shooter:
   search_events(...) → get_match(ct, id)
   → note competitors[n].shooterId (global, stable integer)
   → get_shooter_dashboard(shooter_id)

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
  • competitors[n].shooterId is the GLOBAL stable shooter ID (use with get_shooter_dashboard).

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

get_shooter_dashboard
  Cross-competition career profile for a single shooter.
  • Input: shooter_id from get_match competitors[n].shooterId (global ID, not per-match id).
  • Returns: profile (name, club, division), up to 50 recent matches with per-match stats,
    aggregate stats (overall match %, avg HF, A-zone %, consistency CV, HF trend slope),
    and achievement progress.
  • Returns 404 if the shooter has not been seen in any cached match on this server.

find_shooter
  Search for shooters by name in the local database.
  • Returns shooter_id values that can be passed directly to get_shooter_dashboard.
  • Only searches shooters already indexed on this server (i.e. seen in a cached match).
  • Empty query returns the most recently active shooters (useful for browsing).
  • openWorldHint: false — local data only, not a live SSI search.

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

COMSTOCK SCORING (the standard IPSC method)
-------------------------------------------
Each stage is scored by Hit Factor (HF):

  HF = (scored_points − penalties) / time_in_seconds

Penalties are subtracted from points BEFORE dividing by time.
Time starts on the start signal and stops on the last shot.

The competitor with the highest HF on a stage earns 100 % of the stage
points available; every other competitor is scaled proportionally:

  Stage score % = (competitor_HF / stage_winner_HF) × 100

Match total = sum of stage points (each stage equally weighted).
A 100 % on every stage = a perfect match.

SCORING ZONES — paper targets (best stipulated hits, usually 2 per target)
---------------------------------------------------------------------------
Zone  Major PF  Minor PF  Notes
A         5         5     Centre — hardest to hit
C         4         3     Outer scoring zone (B-zone combined into C in SSI data)
D         2         1     Edge of cardboard
M       −10       −10     Miss / Fail to Engage — per required scoring hit
                          (−20 total for a 2-hit paper target with both misses)
NS      −10       −10     No-Shoot (hostage / non-threat) — per hit, max −20 per target
PE      −10       −10     Procedural error (e.g. foot fault) — per occurrence

Metal targets (poppers, plates): full value (typically 5 pts) if activated;
no deduction if missed (unlike paper, which penalises misses).

Power Factor (Major / Minor) is fixed per shooter and division before the match.
Major PF divisions: Open, Standard (often). Minor PF: Production, Production Optics,
PCC Optics/Iron, Revolver (typically). Classic can be either; check sub_rule.
A Major shooter scores more on C/D hits — this directly affects cross-division
point totals and is why raw points CANNOT be used to compare across divisions.

CROSS-DIVISION RANKING
----------------------
Raw points cannot be used to compare competitors across divisions or stages:
• Different divisions use different power factors (Major vs Minor C/D scores differ).
• Different stages have different max_points and round counts.
ALWAYS use match % (average per-stage HF%) to rank performance.
overall_rank = the competitor's final rank across ALL competitors in the match.
A competitor with fewer total points can rank HIGHER if their HF% is better.

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
// Server instructions — injected into the MCP initialize result so that
// Claude Desktop / claude.ai use it as a system prompt without the model
// needing to explicitly read the "guide" resource first.
// Keep it compact: authoritative workflow + the rules that models most often
// get wrong (ID resolution, min_level defaults).
// ---------------------------------------------------------------------------

export const SERVER_INSTRUCTIONS = `\
You have access to IPSC competition data via the SSI Scoreboard tools.

WORKFLOW — always follow these steps in order:
1. search_events(query="<match name>")      → find the match; note id + content_type
2. get_match(ct, id)                        → load competitors; resolve names to numeric IDs
3. compare_competitors(ct, id, [ids])       → deep stage-by-stage analysis

For cross-competition career stats (when you have a match open):
2b. From get_match, note competitors[n].shooterId (global stable integer, NOT the per-match id)
3b. get_shooter_dashboard(shooter_id)       → career history, aggregate stats, achievements

For finding a shooter by name (without a specific match):
find_shooter(query="<name>")               → list of matching shooters with shooter_id
→ get_shooter_dashboard(shooter_id)        → full career profile

RULES:
• competitor_ids are INTEGERS from get_match — never guess or invent them.
• shooter_id for get_shooter_dashboard / find_shooter comes from get_match
  competitors[n].shooterId (global, stable) — NOT competitors[n].id (per-match only).
• find_shooter searches local data only — it will not find shooters who have never
  appeared in a cached match on this server.
• min_level: omit (defaults to l2plus = Regional+). Use "all" ONLY when the user
  explicitly asks about club matches or Level I events.
• get_popular_matches: call first when the user has NOT named a specific match.
• When the user names a person and a match, go directly to search_events → get_match
  → compare_competitors. Do not ask for clarification unless results are ambiguous.

PERFORMANCE RANKING — READ THIS CAREFULLY:
• NEVER rank or compare competitors by raw points. Points are meaningless across
  stages (each stage has different max_points) and across divisions (Classic Minor,
  Production, Standard Minor, Open etc. score differently). A high point total does
  NOT mean a better result.
• CORRECT metric: hit-factor percentage vs stage winner, averaged across all stages.
  - penaltyStats[id].matchPctActual  →  competitor's average GROUP % (relative to
    the best competitor in YOUR selected group). Use this for intra-group ranking.
  - Per-stage overall_percent (in stage.competitors[id])  →  HF% vs the OVERALL
    stage winner across all 158+ competitors. Average these for cross-field ranking.
  - overall_rank  →  final rank across ALL competitors regardless of division.
    Use this — not points — to answer "who performed best?" across divisions.
  - div_rank  →  rank within the competitor's own division. Use for same-division Qs.
• Example: if Anton has 501 pts (rank 108/158) and Martin has 428 pts (rank 96/158),
  Martin performed BETTER overall even though Anton had more points. Always check
  overall_rank and overall_percent, not the raw points field.

PRE-MATCH PREPARATION (scoring_completed = 0):
• get_match returns full stage data even before shooting starts.
• Stage rotation (IPSC round-robin):
    stage_index = ((squad_number − 1) + (round − 1)) % total_stages
  where stages are sorted by stage_number (1-indexed) and rounds start at 1.
• Parse constraint signals from stage text fields:
    procedure:         /strong hand/i, /weak hand/i, /moving target/i
    firearm_condition: /empty|unloaded/i  → unloaded start
• Call get_shooter_dashboard(shooter_id) to add career context (avg match %,
  penalty rate) for personalised preparation advice.

DATA NOTES:
• scoring_completed (0–100 %) on get_match shows how much of the match is scored.
• dnf=true / dq=true competitors should be flagged in your summary.
• All percentages in compare_competitors are relative to the group leader unless
  the field has a "div_" or "overall_" prefix.
`;

// ---------------------------------------------------------------------------
// Data providers
//
// The tool handlers are agnostic about how data is fetched.  Callers supply a
// DataProviders object with typed async functions:
//
//   • HTTP mode  (stdio server / Smithery): createHttpProviders(baseUrl) wraps
//     each function in a fetch() call so the stdio process stays stateless and
//     points at any live server instance.
//
//   • Direct mode (Cloudflare HTTP MCP endpoint): app/api/mcp/route.ts imports
//     lib/api-data.ts and passes its functions directly — no HTTP round-trip.
//     This avoids the Cloudflare 522 "Connection Timed Out" that occurs when a
//     Worker tries to subrequest its own Cloudflare Pages custom domain.
// ---------------------------------------------------------------------------

export interface DataProviders {
  searchEvents: (params: {
    query?: string;
    min_level?: "all" | "l2plus" | "l3plus" | "l4plus";
    country?: string;
    starts_after?: string;
    starts_before?: string;
  }) => Promise<EventSummary[]>;
  getMatch: (ct: string, id: string) => Promise<MatchResponse>;
  compareCompetitors: (ct: string, id: string, ids: number[]) => Promise<CompareResponse>;
  getPopularMatches: () => Promise<PopularMatch[]>;
  getShooterDashboard: (shooterId: number) => Promise<ShooterDashboardResponse>;
  searchShooterProfiles: (params: { query: string; limit?: number }) => Promise<ShooterSearchResult[]>;
}

// Header sent on every REST call from the MCP stdio/Smithery shims so the
// REST handlers can tag downstream telemetry with via:"mcp" (see
// lib/telemetry-context.ts and the route handlers' isMcpRequest() check).
const MCP_CLIENT_HEADER = "x-mcp-client";

async function apiFetch<T>(baseUrl: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { [MCP_CLIENT_HEADER]: "stdio" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${baseUrl}${path}`);
  return res.json() as Promise<T>;
}

function createHttpProviders(baseUrl: string): DataProviders {
  return {
    searchEvents: async (params) => {
      const p = new URLSearchParams();
      if (params.query) p.set("q", params.query);
      if (params.min_level) p.set("minLevel", params.min_level);
      if (params.country) p.set("country", params.country);
      if (params.starts_after) p.set("starts_after", params.starts_after);
      if (params.starts_before) p.set("starts_before", params.starts_before);
      return apiFetch<EventSummary[]>(baseUrl, `/api/events?${p}`);
    },
    getMatch: (ct, id) => apiFetch<MatchResponse>(baseUrl, `/api/match/${ct}/${id}`),
    compareCompetitors: (ct, id, ids) => {
      const p = new URLSearchParams({ ct, id, competitor_ids: ids.join(","), mode: "coaching" });
      return apiFetch<CompareResponse>(baseUrl, `/api/compare?${p}`);
    },
    getPopularMatches: () => apiFetch<PopularMatch[]>(baseUrl, "/api/popular-matches"),
    getShooterDashboard: (shooterId) => apiFetch<ShooterDashboardResponse>(baseUrl, `/api/shooter/${shooterId}`),
    searchShooterProfiles: async (params) => {
      const p = new URLSearchParams({ q: params.query });
      if (params.limit) p.set("limit", String(params.limit));
      return apiFetch<ShooterSearchResult[]>(baseUrl, `/api/shooter/search?${p}`);
    },
  };
}

export function registerMcpTools(server: McpServer, arg: string | DataProviders): void {
  const providers: DataProviders = typeof arg === "string" ? createHttpProviders(arg) : arg;
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
      const data = await providers.searchEvents(input);
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
    "`ct` and `id` come from a search_events result (the `content_type` and `id` fields of the event). " +
    "Each stage in `stages[]` includes `procedure` (free-text stage instructions), `firearm_condition` (loading requirements such as 'Unloaded'), " +
    "`course_display` ('Short'/'Medium'/'Long'), `min_rounds`, `paper_targets`, and `steel_targets`. " +
    "When `scoring_completed` is 0 (pre-match), use these fields for preparation analysis: " +
    "compute the round-robin stage rotation for a squad, parse constraint signals from text, and summarise the course breakdown.",
    {
      ct: z.string().describe("content_type value from a search_events result (typically '22' for IPSC matches)"),
      id: z.string().describe("id value from a search_events result"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ ct, id }) => {
      const data = await providers.getMatch(ct, id);
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
    "IMPORTANT — ranking across competitors: NEVER rank by raw points. " +
    "Points are not comparable across divisions (Production vs Classic Minor vs Standard Minor etc.) or across stages (each stage has different max_points). " +
    "Use `overall_rank` (rank across all competitors regardless of division) and the average of per-stage `overall_percent` to rank cross-division. " +
    "Use `div_rank` for within-division ranking. " +
    "Use `penaltyStats[id].matchPctActual` for group-relative average match %. " +
    "Results are suitable for natural-language coaching feedback, identifying where points were lost, and ranking analysis.",
    {
      ct: z.string().describe("content_type value from the search_events result for this match"),
      id: z.string().describe("id value from the search_events result for this match"),
      competitor_ids: z.array(z.number().int().positive()).min(1).max(12)
        .describe("Numeric competitor IDs from get_match. Up to 12. Resolve names to IDs with get_match before calling this."),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ ct, id, competitor_ids }) => {
      const data = await providers.compareCompetitors(ct, id, competitor_ids);
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
      const data = await providers.getPopularMatches();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "get_shooter_dashboard",
    "Fetch a shooter's cross-competition profile and career statistics. " +
    "Returns: profile (name, club, division), match history (up to 50 recent matches with per-match stats), " +
    "aggregate stats (overall match %, average hit factor, A-zone %, consistency CV, HF trend slope), " +
    "and achievement progress (tiered milestones). " +
    "Use this to answer questions about a shooter's performance across multiple matches, their consistency over time, " +
    "or how their accuracy has been trending. " +
    "The `shooter_id` is the globally stable SSI ShooterNode ID — obtain it from `get_match`'s " +
    "`competitors[n].shooterId` field (an integer, distinct from the per-match `competitors[n].id`). " +
    "Returns 404 if the shooter has not been seen in any cached match on this server. " +
    "Each match in `matches[]` includes `ct` and `matchId` so you can call `get_match` or `compare_competitors` " +
    "to drill into a specific competition.",
    {
      shooter_id: z.number().int().positive()
        .describe("Globally stable SSI shooter ID — from get_match competitors[n].shooterId (not the per-match competitor id)"),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ shooter_id }) => {
      const data = await providers.getShooterDashboard(shooter_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "find_shooter",
    "Search for shooter profiles by name. " +
    "Returns a list of matching shooters with their shooter_id — pass that ID to " +
    "get_shooter_dashboard to load their full career history. " +
    "Only shooters who have appeared in at least one cached match on this server are searchable. " +
    "Pass an empty query to browse the most recently active shooters. " +
    "Use this when you know a shooter's name but not their shooter_id, as an alternative to " +
    "browsing get_match competitor lists.",
    {
      query: z.string().default("").describe("Name to search for (case-insensitive substring match). Empty string returns recently seen shooters."),
      limit: z.number().int().min(1).max(100).optional().default(20)
        .describe("Maximum number of results to return. Defaults to 20."),
    },
    { readOnlyHint: true, openWorldHint: false },
    async ({ query, limit }) => {
      const data = await providers.searchShooterProfiles({ query, limit });
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
    "pre_match_prep",
    "Generate a pre-match preparation brief for a shooter at an upcoming IPSC match",
    {
      match_name: z.string().describe("Name of the upcoming IPSC match (partial name is fine)"),
      competitor_name: z.string().describe("Full or partial name of the competitor to prepare"),
      squad: z.string().optional().describe("Squad name or number (e.g. 'Squad 3'). If provided, shows the stage rotation order."),
    },
    ({ match_name, competitor_name, squad }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please prepare a pre-match brief for ${competitor_name} at "${match_name}".\n\n` +
              `Steps:\n` +
              `1. Use search_events with query="${match_name}" to find the match.\n` +
              `2. Use get_match to load stages, competitors, and squads.\n` +
              `3. Find ${competitor_name} in the competitor list — note their squad assignment.\n` +
              (squad
                ? `4. The competitor is in "${squad}". Compute the IPSC round-robin stage rotation:\n`
                : `4. If the competitor's squad is known, compute the IPSC round-robin stage rotation:\n`) +
              `   stage_index = ((squad_number − 1) + (round − 1)) % total_stages\n` +
              `   List stages in the order the competitor will shoot them.\n` +
              `5. For each stage summarise: course length (Short/Medium/Long), round count,\n` +
              `   target breakdown (paper / steel), and any constraints\n` +
              `   (strong hand, weak hand, unloaded start, moving targets).\n` +
              `6. Use get_shooter_dashboard to load the competitor's career history and aggregate stats.\n` +
              `7. Produce a preparation brief covering:\n` +
              `   • Match overview: level, total stages, total rounds, constraint breakdown\n` +
              `   • Stage rotation order (if squad known)\n` +
              `   • Stages to watch: any constrained or long stages worth extra mental prep\n` +
              `   • Historical context: career avg match %, recent trend, penalty rate\n` +
              `   • 2–3 specific, actionable preparation tips tailored to their profile`,
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
