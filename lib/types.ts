// Single source of truth for all TypeScript interfaces.
// All fields that may be absent during an active match are nullable.

export interface StageInfo {
  id: number;
  name: string;
  stage_number: number;
  max_points: number;
}

export interface CompetitorInfo {
  id: number;
  name: string;
  competitor_number: string;
  club: string | null;
  division: string | null;
}

export interface MatchResponse {
  name: string;
  venue: string | null;
  date: string | null;
  level: string | null;
  sub_rule: string | null;
  region: string | null;
  stages_count: number;
  competitors_count: number;
  scoring_completed: number; // percentage 0-100
  stages: StageInfo[];
  competitors: CompetitorInfo[];
}

export interface StageResult {
  stage_id: number;
  stage_number: number;
  stage_name: string;
  hit_factor: number | null;
  points: number | null;
  time: number | null;
  dq: boolean;
  zeroed: boolean;
  dnf: boolean;
  a_hits: number | null;
  c_hits: number | null;
  d_hits: number | null;
  miss_count: number | null;
  penalty_count: number | null;
}

export interface ScoreCard {
  competitor_id: number;
  competitor_name: string;
  competitor_number: string;
  club: string | null;
  division: string | null;
  stages: StageResult[];
}

export interface CompetitorSummary {
  competitor_id: number;
  points: number | null;
  hit_factor: number | null;
  time: number | null;
  group_rank: number | null; // rank within the selected group for this stage
  group_percent: number | null; // percentage of stage leader's points (within group)
  dq: boolean;
  zeroed: boolean;
  dnf: boolean;
}

export interface StageComparison {
  stage_id: number;
  stage_name: string;
  stage_num: number;
  max_points: number;
  group_leader_points: number | null; // reserved for future benchmark overlay — do not remove
  competitors: Record<number, CompetitorSummary>; // keyed by competitor_id
}

export interface CompareResponse {
  match_id: number;
  stages: StageComparison[];
  competitors: CompetitorInfo[];
}
