// Server-only — never import from client components or files with "use client".
// SSI_API_KEY lives here and must never be sent to the browser.

const GRAPHQL_ENDPOINT = "https://shootnscoreit.com/graphql/";

interface GraphQLError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export async function executeQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  revalidate: number | false = false,
): Promise<T> {
  const apiKey = process.env.SSI_API_KEY;
  if (!apiKey) throw new Error("SSI_API_KEY is not configured");

  // Extract the operation name for log context, e.g. "GetMatchScorecards"
  const operationName = query.match(/query\s+(\w+)/)?.[1] ?? "unknown";

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: revalidate === false ? "no-store" : undefined,
    next: revalidate !== false ? { revalidate } : undefined,
  });

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    let body = "";
    try { body = (await response.text()).slice(0, 300); } catch { /* ignore */ }

    const parts = [
      `[ssi-api] ${operationName} failed`,
      `HTTP ${response.status} ${response.statusText}`,
      `vars=${JSON.stringify(variables ?? {})}`,
      retryAfter ? `Retry-After=${retryAfter}` : null,
      body ? `body=${body}` : null,
    ].filter(Boolean);
    console.error(parts.join(" | "));

    const clientMsg = retryAfter
      ? `Upstream HTTP ${response.status}: ${response.statusText} (Retry-After: ${retryAfter}s)`
      : `Upstream HTTP ${response.status}: ${response.statusText}`;
    throw new Error(clientMsg);
  }

  const result: GraphQLResponse<T> = await response.json();

  if (result.errors?.length) {
    const msg = result.errors.map((e) => e.message).join("; ");
    console.error(`[ssi-api] ${operationName} GraphQL error | vars=${JSON.stringify(variables ?? {})} | ${msg}`);
    throw new Error(msg);
  }

  if (!result.data) {
    console.error(`[ssi-api] ${operationName} empty response | vars=${JSON.stringify(variables ?? {})}`);
    throw new Error("Empty response from upstream API");
  }

  return result.data;
}

// ─── Query: match overview ───────────────────────────────────────────────────
// `venue` and `scoring_completed` are on EventInterface (top level).
// `sub_rule`, `level`, `region`, `stages_count`, `competitors_count`, and
// the nested lists require `... on IpscMatchNode`.
//
// `scoring_completed` is returned as a decimal string (e.g. "56.31067961165048"),
// not a number. Parse with parseFloat() in the route handler.
//
// `competitor(content_type, id)` at the top level returns 404 in practice.
// All competitor/scorecard data is fetched via the event node.
export const MATCH_QUERY = `
  query GetMatch($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      id
      get_content_type_key
      name
      venue
      starts
      scoring_completed
      ... on IpscMatchNode {
        region
        sub_rule
        level
        stages_count
        competitors_count
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
            minimum_rounds
            paper
            popper
            plate
            get_full_absolute_url
          }
        }
        competitors_approved_w_wo_results_not_dnf {
          id
          get_content_type_key
          ... on IpscCompetitorNode {
            first_name
            last_name
            number
            club
            handgun_div
            get_handgun_div_display
            shoots_handgun_major
          }
        }
      }
    }
  }
`;

// ─── Query: list IPSC handgun events ─────────────────────────────────────────
// Returns all publicly-visible IPSC handgun & PCC matches (firearms:"hg")
// filtered by optional free-text search and date range.
// Results include both IpscMatchNode (ct=22) and IpscSerieNode (ct=43) —
// filter to ct=22 in the route handler.
export const EVENTS_QUERY = `
  query GetEvents($search: String, $starts_after: String, $starts_before: String, $firearms: String) {
    events(rule: "ip", firearms: $firearms, search: $search, starts_after: $starts_after, starts_before: $starts_before) {
      id
      get_content_type_key
      name
      venue
      starts
      status
      region
      get_full_rule_display
      get_full_level_display
    }
  }
`;

// ─── Query: all stage scorecards for a match ─────────────────────────────────
// Returns raw scorecard data for every competitor on every stage.
// `get_results` (official placement) is blocked during active matches — this
// query uses the raw scorecards path which is always accessible.
// Filter the response to the desired competitor IDs server-side.
export const SCORECARDS_QUERY = `
  query GetMatchScorecards($ct: Int!, $id: String!) {
    event(content_type: $ct, id: $id) {
      ... on IpscMatchNode {
        stages {
          id
          number
          name
          ... on IpscStageNode {
            max_points
          }
          scorecards {
            ... on IpscScoreCardNode {
              points
              hitfactor
              time
              disqualified
              zeroed
              stage_not_fired
              ascore
              bscore
              cscore
              dscore
              miss
              penalty
              procedural
              competitor {
                id
                ... on IpscCompetitorNode {
                  first_name
                  last_name
                  number
                  club
                  handgun_div
                  get_handgun_div_display
                }
              }
            }
          }
        }
      }
    }
  }
`;
