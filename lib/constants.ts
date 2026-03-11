// Shared constants used across server and client code.

export const MAX_COMPETITORS = 12;

/**
 * Cache schema version — embedded in every cached GraphQL response.
 * Bump this (by 1) whenever the *shape* of a cached API response changes
 * (e.g. new fields added to MatchResponse, CompareResponse, etc.).
 * Old entries missing this field or carrying an older version are treated
 * as cache misses and re-fetched automatically — no manual flush needed.
 *
 * History:
 *   1 → initial (implicit, unversioned entries)
 *   2 → added squads[] to MatchResponse (squad picker feature)
 *   3 → added image { url width height } to IpscMatchNode in MATCH_QUERY (OG images)
 *   4 → added match_status + results_status to MatchResponse (results published flag)
 *   5 → added procedure, firearm_condition, course, get_course_display to IpscStageNode in MATCH_QUERY
 *   6 → added shooter { id } to IpscCompetitorNode in MATCH_QUERY; shooterId on CompetitorInfo
 *   7 → added region, get_region_display, category, ics_alias, license to IpscCompetitorNode
 *   8 → added get_division_display to IpscCompetitorNode in MATCH_QUERY + SCORECARDS_QUERY;
 *       added get_full_rule_display to IpscMatchNode (multi-discipline support)
 *   9 → added lat, lng to IpscMatchNode in MATCH_QUERY; lat/lng on MatchResponse (venue coordinates)
 */
export const CACHE_SCHEMA_VERSION = 9;
