// Single source of truth for all TypeScript interfaces.
// All fields that may be absent during an active match are nullable.

export interface StageInfo {
  id: number;
  name: string;
  stage_number: number;
  max_points: number;
  min_rounds: number | null;
  paper_targets: number | null;
  steel_targets: number | null;
  ssi_url: string | null;
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
  ssi_url: string | null;
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
  incomplete: boolean;
  a_hits: number | null;
  c_hits: number | null;
  d_hits: number | null;
  miss_count: number | null;
  no_shoots: number | null;
  procedurals: number | null;
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
  // Group context: rank/% within the selected set of competitors
  group_rank: number | null;
  group_percent: number | null; // HF as % of group leader's HF
  // Division context: rank/% within competitor's own division (computed from full field)
  div_rank: number | null;
  div_percent: number | null; // HF as % of division leader's HF
  // Overall context: rank/% across all competitors in the match regardless of division
  overall_rank: number | null;
  overall_percent: number | null; // HF as % of overall stage leader's HF
  dq: boolean;
  zeroed: boolean;
  dnf: boolean;
  incomplete: boolean;
  a_hits: number | null;
  c_hits: number | null; // B-zone combined into C
  d_hits: number | null;
  miss_count: number | null;
  no_shoots: number | null;
  procedurals: number | null;
  // 1-based index of this stage in the order this competitor shot it.
  // Derived from scorecard submission timestamps (reflects actual shooting order).
  shooting_order?: number | null;
  // Percentile placement within the full field for this stage (0–1, 1 = top).
  // Formula: 1 − (overall_rank − 1) / (N − 1) where N = non-DNF field competitors.
  // null for DNF or when N = 0.
  overall_percentile: number | null;
}

export interface StageComparison {
  stage_id: number;
  stage_name: string;
  stage_num: number;
  max_points: number;
  ssi_url?: string | null;            // direct link to the stage on shootnscoreit.com
  min_rounds?: number | null;
  paper_targets?: number | null;
  steel_targets?: number | null;
  group_leader_hf: number | null;     // best HF in selected group
  group_leader_points: number | null; // best raw pts in selected group — benchmark overlay hook, do not remove
  overall_leader_hf: number | null;   // best HF across full field — benchmark overlay hook
  field_median_hf: number | null;     // median HF across the full field (excludes DNF/DQ/zeroed)
  field_competitor_count: number;     // count of valid field competitors contributing to the median
  stageDifficultyLevel: 1 | 2 | 3 | 4 | 5; // relative difficulty on a 1–5 scale (1=easy, 5=brutal)
  stageDifficultyLabel: string;       // human-readable label: easy/moderate/hard/very hard/brutal
  competitors: Record<number, CompetitorSummary>; // keyed by competitor_id
}

// Percentage context for the comparison view.
// "group"    — HF % relative to the group leader (selected competitors only)
// "division" — HF % relative to the division winner (full field, per competitor's division)
// "overall"  — HF % relative to the overall stage winner (full field, all divisions)
export type PctMode = "group" | "division" | "overall";

export interface CompareResponse {
  match_id: number;
  stages: StageComparison[];
  competitors: CompetitorInfo[];
}

export interface EventSummary {
  id: number;
  content_type: number;
  name: string;
  venue: string | null;
  date: string; // ISO timestamp
  status: string; // "on" | "cp" | "dr" | "cs" | "pr" | "ol"
  region: string;
  discipline: string; // e.g. "IPSC Handgun & PCC"
  level: string; // e.g. "Level II"
}
