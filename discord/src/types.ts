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
  level: string;
  status: string;
  region: string;
  discipline: string;
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
    definition: { id: string; name: string; icon: string };
    unlockedTiers: Array<{ level: number }>;
  }>;
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
