// Environment bindings for the Cloudflare Worker
export interface Env {
  // Secrets (set via `wrangler secret put`)
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;

  // Variables (set in wrangler.toml or secrets)
  SCOREBOARD_BASE_URL: string;

  // KV namespace for shooter mapping + watch state
  BOT_KV: KVNamespace;
}

// --- Scoreboard API response types (subset of what we need) ---
// These must match the actual API responses from the Next.js app.

/** GET /api/events?q=... — event search results. */
export interface EventSearchResult {
  id: number;
  content_type: number;
  name: string;
  venue: string | null;
  date: string;
  ends: string | null;
  level: string;
  status: string;
  region: string;
  discipline: string;
  registration_status: string;
  registration_starts: string | null;
  registration_closes: string | null;
  is_registration_possible: boolean;
  squadding_starts: string | null;
  squadding_closes: string | null;
  is_squadding_possible: boolean;
  max_competitors: number | null;
}

/** GET /api/match/{ct}/{id} — full match data. */
export interface MatchResponse {
  name: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  scoring_completed: number;
  competitors_count: number;
  stages_count: number;
  /** When squadding opens (ISO timestamp); null if not set. */
  squadding_starts: string | null;
  /** Whether squadding is currently open. */
  is_squadding_possible: boolean;
  stages: MatchStage[];
  competitors: MatchCompetitor[];
  squads: SquadInfo[];
}

export interface MatchCompetitor {
  id: number;
  shooterId: number | null;
  name: string;
  division: string | null;
  club: string | null;
  category: string | null;
  region: string | null;
}

export interface MatchStage {
  id: number;
  stage_number: number;
  name: string;
  max_points: number;
  min_rounds: number | null;
}

export interface SquadInfo {
  number: number;
  name: string;
  competitorIds: number[];
}

/** Upcoming match from the shooter dashboard. */
export interface UpcomingMatch {
  ct: string;
  matchId: string;
  name: string;
  date: string | null;
  venue: string | null;
  level: string | null;
  division: string | null;
  competitorId: number;
  registrationStarts: string | null;
  registrationCloses: string | null;
  isRegistrationPossible: boolean;
  squaddingStarts: string | null;
  squaddingCloses: string | null;
  isSquaddingPossible: boolean;
  isRegistered: boolean;
  isSquadded: boolean;
}

/** GET /api/shooter/{shooterId} — dashboard response. */
export interface ShooterDashboardResponse {
  shooterId: number;
  profile: {
    name: string;
    club: string | null;
    division: string | null;
    lastSeen: string;
  } | null;
  matchCount: number;
  matches: Array<{
    name: string;
    date: string | null;
    matchPct: number | null;
    stageCount: number;
  }>;
  stats: {
    totalStages: number;
    overallMatchPct: number | null;
  };
  achievements?: Array<{
    definition: {
      id: string;
      name: string;
      icon: string;
      tiers: Array<{ level: number; name: string; label: string }>;
    };
    unlockedTiers: Array<{ level: number }>;
    nextTier: { name: string; label: string } | null;
  }>;
  /** Matches with start date in the future. Only present when non-empty. */
  upcomingMatches?: UpcomingMatch[];
}

/** GET /api/shooter/search?q=... — shooter search results. */
export interface ShooterSearchResult {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
}

// Subset of CompareResponse needed for stage-scored notifications.
// We only care about per-competitor per-stage results.

/** GET /api/compare?ct=...&id=...&competitor_ids=... */
export interface CompareResult {
  stages: Array<{
    stage_id: number;
    stage_name: string;
    stage_num: number;
    max_points: number;
    overall_leader_hf: number | null;
    competitors: Record<number, CompetitorStageResult>;
  }>;
  competitors: Array<{
    id: number;
    name: string;
    division: string | null;
    club: string | null;
  }>;
}

export interface CompetitorStageResult {
  competitor_id: number;
  hit_factor: number | null;
  points: number | null;
  time: number | null;
  overall_rank: number | null;
  overall_percent: number | null;
  a_hits: number | null;
  c_hits: number | null;
  d_hits: number | null;
  miss_count: number | null;
  dnf: boolean;
  dq: boolean;
  incomplete: boolean;
}

/** Per-competitor penalty stats from the compare endpoint (coaching mode). */
export interface CompetitorPenaltyStats {
  totalPenalties: number;
  penaltyCostPercent: number;
  matchPctActual: number;
  matchPctClean: number;
  penaltiesPerStage: number;
  penaltiesPer100Rounds: number;
}

/** CompareResult extended with penaltyStats for prediction reveals. */
export interface CompareResultWithPenaltyStats extends CompareResult {
  penaltyStats: Record<number, CompetitorPenaltyStats>;
}
