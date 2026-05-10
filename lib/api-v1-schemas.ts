// Public API v1 — Zod-validated response contract.
//
// THESE SCHEMAS ARE THE V1 CONTRACT. External consumers (splitsmith and any
// future ones) pin to the shapes defined here.
//
// Rules of engagement:
//   - Adding an OPTIONAL field: extend the relevant schema, bump no version.
//     This is the only kind of change allowed within v1.
//   - Removing, renaming, or retyping a field: not allowed. Bump to /api/v2/.
//     Do NOT edit these schemas to silence a test — the test is the contract.
//   - The error-envelope `code` enum is closed; adding a new code requires v2.
//
// Schemas use `.strict()` so any unrecognized property is a hard error. That
// makes the v1 surface impossible to extend by accident — internal type
// changes (e.g. someone adds a field to MatchResponse) are caught in CI
// instead of silently leaking into the public surface.
//
// See docs/api-v1.md for the prose contract and CLAUDE.md → "Public API v1"
// for the operational notes.

import { z } from "zod";

// ─── Shared ──────────────────────────────────────────────────────────────────

const cacheInfoSchema = z
  .object({
    cachedAt: z.string().nullable(),
    upstreamDegraded: z.boolean().optional(),
    lastScorecardAt: z.string().nullable().optional(),
    scorecardsCachedAt: z.string().nullable().optional(),
  })
  .strict();

export const v1ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.enum([
          "unauthorized",
          "rate_limited",
          "not_found",
          "upstream_failed",
          "bad_request",
        ]),
        message: z.string(),
      })
      .strict(),
  })
  .strict();
export type V1ErrorEnvelope = z.infer<typeof v1ErrorEnvelopeSchema>;

// ─── /api/v1/events ──────────────────────────────────────────────────────────

export const v1EventSchema = z
  .object({
    id: z.number(),
    content_type: z.number(),
    name: z.string(),
    venue: z.string().nullable(),
    date: z.string(),
    ends: z.string().nullable(),
    status: z.string(),
    region: z.string(),
    discipline: z.string(),
    level: z.string(),
    /**
     * Match-level scoring percentage (0-100). SSI deprecated the upstream
     * field this comes from with the note "Always returns 0", so this value
     * is now always 0 — we keep the field on the v1 surface for additive
     * compatibility. Per-match scoring is available on the
     * /api/v1/match/{ct}/{id} endpoint.
     */
    scoring_completed: z.number(),
    registration_status: z.string(),
    registration_starts: z.string().nullable(),
    registration_closes: z.string().nullable(),
    is_registration_possible: z.boolean(),
    squadding_starts: z.string().nullable(),
    squadding_closes: z.string().nullable(),
    is_squadding_possible: z.boolean(),
    max_competitors: z.number().nullable(),
  })
  .strict();
export type V1Event = z.infer<typeof v1EventSchema>;

export const v1EventsResponseSchema = z.array(v1EventSchema);
export type V1EventsResponse = z.infer<typeof v1EventsResponseSchema>;

// ─── /api/v1/match/{ct}/{id} ─────────────────────────────────────────────────

const v1StageSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    stage_number: z.number(),
    max_points: z.number(),
    min_rounds: z.number().nullable(),
    paper_targets: z.number().nullable(),
    steel_targets: z.number().nullable(),
    ssi_url: z.string().nullable(),
    course_display: z.string().nullable(),
    procedure: z.string().nullable(),
    firearm_condition: z.string().nullable(),
  })
  .strict();

const v1CompetitorSchema = z
  .object({
    id: z.number(),
    shooterId: z.number().nullable(),
    name: z.string(),
    competitor_number: z.string(),
    club: z.string().nullable(),
    division: z.string().nullable(),
    region: z.string().nullable(),
    region_display: z.string().nullable(),
    category: z.string().nullable(),
    ics_alias: z.string().nullable(),
    license: z.string().nullable(),
  })
  .strict();

const v1SquadSchema = z
  .object({
    id: z.number(),
    number: z.number(),
    name: z.string(),
    competitorIds: z.array(z.number()),
  })
  .strict();

const v1VisibilitySchema = z
  .object({
    class: z.enum(["public", "unlisted", "organizer-published"]),
    rawCode: z.string(),
    displayName: z.string(),
  })
  .strict();

export const v1MatchResponseSchema = z
  .object({
    name: z.string(),
    venue: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    date: z.string().nullable(),
    ends: z.string().nullable(),
    level: z.string().nullable(),
    sub_rule: z.string().nullable(),
    discipline: z.string().nullable(),
    region: z.string().nullable(),
    stages_count: z.number(),
    competitors_count: z.number(),
    max_competitors: z.number().nullable(),
    scoring_completed: z.number(),
    match_status: z.string(),
    results_status: z.string(),
    registration_status: z.string(),
    registration_starts: z.string().nullable(),
    registration_closes: z.string().nullable(),
    is_registration_possible: z.boolean(),
    squadding_starts: z.string().nullable(),
    squadding_closes: z.string().nullable(),
    is_squadding_possible: z.boolean(),
    ssi_url: z.string().nullable(),
    visibility: v1VisibilitySchema,
    is_live_scores_accessible: z.boolean(),
    stages: z.array(v1StageSchema),
    competitors: z.array(v1CompetitorSchema),
    squads: z.array(v1SquadSchema),
    cacheInfo: cacheInfoSchema,
  })
  .strict();
export type V1MatchResponse = z.infer<typeof v1MatchResponseSchema>;

// ─── /api/v1/match/{ct}/{id}/competitor/{competitorId}/stages ────────────────

const v1CompetitorStageResultSchema = z
  .object({
    stage_number: z.number(),
    stage_id: z.number(),
    time_seconds: z.number().nullable(),
    scorecard_updated_at: z.string().nullable(),
    hit_factor: z.number().nullable(),
    stage_points: z.number().nullable(),
    stage_pct: z.number().nullable(),
    alphas: z.number().nullable(),
    charlies: z.number().nullable(),
    deltas: z.number().nullable(),
    misses: z.number().nullable(),
    no_shoots: z.number().nullable(),
    procedurals: z.number().nullable(),
    dq: z.boolean(),
  })
  .strict();

export const v1CompetitorStagesResponseSchema = z
  .object({
    ct: z.number(),
    matchId: z.number(),
    competitorId: z.number(),
    shooterId: z.number().nullable(),
    division: z.string().nullable(),
    stages: z.array(v1CompetitorStageResultSchema),
    cacheInfo: cacheInfoSchema,
  })
  .strict();
export type V1CompetitorStagesResponse = z.infer<typeof v1CompetitorStagesResponseSchema>;

// ─── /api/v1/shooter/{shooterId} ─────────────────────────────────────────────

const v1ShooterMatchSummarySchema = z
  .object({
    ct: z.string(),
    matchId: z.string(),
    name: z.string(),
    date: z.string().nullable(),
    venue: z.string().nullable(),
    level: z.string().nullable(),
    region: z.string().nullable(),
    division: z.string().nullable(),
    competitorId: z.number(),
    competitorsInDivision: z.number().nullable(),
    stageCount: z.number(),
    avgHF: z.number().nullable(),
    matchPct: z.number().nullable(),
    totalA: z.number(),
    totalC: z.number(),
    totalD: z.number(),
    totalMiss: z.number(),
    totalNoShoots: z.number(),
    totalProcedurals: z.number().optional(),
    dq: z.boolean().optional(),
    perfectStages: z.number().optional(),
    consistencyIndex: z.number().nullable().optional(),
    squadmateShooterIds: z.array(z.number()).optional(),
    squadAllSameClub: z.boolean().optional(),
    discipline: z.string().nullable().optional(),
  })
  .strict();

const v1ShooterProfileSchema = z
  .object({
    name: z.string(),
    club: z.string().nullable(),
    division: z.string().nullable(),
    lastSeen: z.string(),
    region: z.string().nullable(),
    region_display: z.string().nullable(),
    category: z.string().nullable(),
    ics_alias: z.string().nullable(),
    license: z.string().nullable(),
  })
  .strict();

const v1ShooterStatsSchema = z
  .object({
    totalStages: z.number(),
    dateRange: z
      .object({
        from: z.string().nullable(),
        to: z.string().nullable(),
      })
      .strict(),
    overallAvgHF: z.number().nullable(),
    overallMatchPct: z.number().nullable(),
    aPercent: z.number().nullable(),
    cPercent: z.number().nullable(),
    dPercent: z.number().nullable(),
    missPercent: z.number().nullable(),
    consistencyCV: z.number().nullable(),
    hfTrendSlope: z.number().nullable(),
    avgPenaltyRate: z.number().nullable().optional(),
    avgConsistencyIndex: z.number().nullable().optional(),
  })
  .strict();

const v1UpcomingMatchSchema = z
  .object({
    ct: z.string(),
    matchId: z.string(),
    name: z.string(),
    date: z.string().nullable(),
    venue: z.string().nullable(),
    level: z.string().nullable(),
    division: z.string().nullable(),
    competitorId: z.number(),
    registrationStarts: z.string().nullable(),
    registrationCloses: z.string().nullable(),
    isRegistrationPossible: z.boolean(),
    squaddingStarts: z.string().nullable(),
    squaddingCloses: z.string().nullable(),
    isSquaddingPossible: z.boolean(),
    isRegistered: z.boolean(),
    isSquadded: z.boolean(),
  })
  .strict();

const v1AchievementProgressSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    description: z.string(),
    unlockedTier: z.string().nullable(),
    nextTier: z.string().nullable(),
    progress: z.number(),
    target: z.number(),
    matchesContributed: z.number().optional(),
  })
  .passthrough();
// `passthrough` here is intentional: the achievement system grows tiers
// over time and we want new tier metadata to flow through without churning
// the v1 schema. The fields above are the locked contract.

export const v1ShooterDashboardSchema = z
  .object({
    shooterId: z.number(),
    profile: v1ShooterProfileSchema.nullable(),
    matchCount: z.number(),
    matches: z.array(v1ShooterMatchSummarySchema),
    stats: v1ShooterStatsSchema,
    upcomingMatches: z.array(v1UpcomingMatchSchema).optional(),
    achievements: z.array(v1AchievementProgressSchema).optional(),
  })
  .strict();
export type V1ShooterDashboard = z.infer<typeof v1ShooterDashboardSchema>;

// ─── /api/v1/shooter/search ──────────────────────────────────────────────────

const v1ShooterSearchResultSchema = z
  .object({
    shooterId: z.number(),
    name: z.string(),
    club: z.string().nullable(),
    division: z.string().nullable(),
    lastSeen: z.string(),
  })
  .strict();

export const v1ShooterSearchResponseSchema = z.array(v1ShooterSearchResultSchema);
export type V1ShooterSearchResponse = z.infer<typeof v1ShooterSearchResponseSchema>;
