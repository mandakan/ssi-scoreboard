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

export interface EventSearchResult {
  id: number;
  content_type: number;
  name: string;
  venue: string;
  date: string;
  level: string;
  scoring_completed: number;
  competitors_count: number;
  stages_count: number;
}

export interface MatchCompetitor {
  id: number;
  shooterId: number;
  name: string;
  division: string;
  club: string;
  category: string | null;
  region: string | null;
}

export interface MatchStage {
  id: number;
  stage_number: number;
  name: string;
  scoring_type: string;
  max_points: number;
  min_rounds: number;
}

export interface SquadInfo {
  number: number;
  name: string;
  competitorIds: number[];
}

export interface MatchResponse {
  id: number;
  content_type: number;
  name: string;
  venue: string;
  date: string;
  level: string;
  scoring_completed: number;
  competitors: MatchCompetitor[];
  stages: MatchStage[];
  squads: SquadInfo[];
}

export interface ShooterDashboardResponse {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
  matchCount: number;
  stageCount: number;
  avgMatchPercent: number | null;
  achievements: Array<{
    id: string;
    name: string;
    tier: string;
    icon: string;
  }>;
  recentMatches: Array<{
    name: string;
    date: string;
    matchPercent: number | null;
  }>;
}

export interface ShooterSearchResult {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
}

// Subset of CompareResponse needed for stage-scored notifications.
// We only care about per-competitor per-stage results.
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
    division: string;
    club: string;
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
