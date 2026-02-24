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
 */
export const CACHE_SCHEMA_VERSION = 2;
