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

export interface SquadInfo {
  id: number;
  number: number;
  name: string;           // e.g. "Squad 1"
  competitorIds: number[]; // approved, non-DNF competitor IDs in this squad
}

export interface CacheInfo {
  cachedAt: string | null; // ISO string of when data was cached; null if just fetched fresh
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
  squads: SquadInfo[];
  cacheInfo: CacheInfo;
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
  // Run quality classification based on HF% vs group leader, A%, and penalty counts.
  // null when there is insufficient data or the run is DNF.
  stageClassification: StageClassification | null;
  // Points left on table due to non-A hit quality (C/D/miss opportunity cost).
  // null when zone data (a_hits, c_hits, d_hits, miss_count) is unavailable, or for DNF/DQ/zeroed.
  hitLossPoints: number | null;
  // Points lost to penalties (miss + no_shoot + procedural × 10 each).
  // Always 0 for DNF; always ≥ 0 for fired stages.
  penaltyLossPoints: number;
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

// Run quality classification for a single stage × competitor result.
// Computed relative to the selected group's leader HF.
// null = not enough data to classify (e.g. missing zone data, DNF).
export type StageClassification = "solid" | "conservative" | "over-push" | "meltdown";

// Percentage context for the comparison view.
// "group"    — HF % relative to the group leader (selected competitors only)
// "division" — HF % relative to the division winner (full field, per competitor's division)
// "overall"  — HF % relative to the overall stage winner (full field, all divisions)
export type PctMode = "group" | "division" | "overall";

// View mode for the comparison table.
// "absolute" — shows raw hit factor, points, and percentage
// "delta"    — shows gap to the group leader per stage (±X.X pts)
export type ViewMode = "absolute" | "delta";

export interface CompetitorPenaltyStats {
  totalPenalties: number;        // total miss + no_shoot + procedural count across all fired stages
  penaltyCostPercent: number;    // group % lost to penalties (matchPctClean − matchPctActual)
  matchPctActual: number;        // actual avg group % (matches "Avg Group %" in totals row)
  matchPctClean: number;         // hypothetical avg group % with zero penalties
  penaltiesPerStage: number;     // total_penalties / stages_shot
  penaltiesPer100Rounds: number; // total_penalties / total_rounds_fired × 100
}

export interface EfficiencyStats {
  pointsPerShot: number | null;  // total_points / total_rounds_fired for this competitor
  fieldMin: number | null;       // min pts/shot across all match competitors
  fieldMedian: number | null;    // median pts/shot across all match competitors
  fieldMax: number | null;       // max pts/shot across all match competitors
  fieldCount: number;            // number of competitors contributing to the distribution
}

export interface ConsistencyStats {
  coefficientOfVariation: number | null; // σ/μ of group_percent; null when fewer than 2 valid stages or mean is 0
  label: string | null;                  // "very consistent" | "consistent" | "moderate" | "variable" | "streaky"
  stagesFired: number;                   // non-DNF, non-DQ, non-zeroed stages with valid group_percent
}

// Match-level aggregate of points-left-on-the-table per competitor.
// Separates lost points into two root causes: hit quality and penalties.
export interface LossBreakdownStats {
  totalHitLoss: number;     // sum of hitLossPoints across non-DNF, non-DQ, non-zeroed stages
  totalPenaltyLoss: number; // sum of penaltyLossPoints across non-DNF, non-DQ, non-zeroed stages
  totalLoss: number;        // totalHitLoss + totalPenaltyLoss
  stagesFired: number;      // non-DNF, non-DQ, non-zeroed stages included in the breakdown
  hasHitZoneData: boolean;  // true if at least one stage had zone data (so hit loss is meaningful)
}

export type ShooterArchetype = "Gunslinger" | "Surgeon" | "Speed Demon" | "Grinder";

// A single competitor's position in the style-fingerprint space, computed
// from raw scorecards across the full field (not only selected competitors).
// Used to render the background cohort cloud on the scatter chart.
export interface FieldFingerprintPoint {
  competitorId: number;
  division: string | null;   // handgun division string (e.g. "production") for cohort filtering
  alphaRatio: number;        // total_A / (total_A + total_C + total_D)
  pointsPerSecond: number;   // total_points / total_time
  penaltyRate: number;       // total_penalties / total_rounds_fired
  /** Percentile rank within the full field, 0–100 (100 = best accuracy). */
  accuracyPercentile: number;
  /** Percentile rank within the full field, 0–100 (100 = fastest). */
  speedPercentile: number;
  cv: number | null;         // coefficient of variation of per-stage HF; null when < 2 stages
}

// Match-level aggregate "style fingerprint" for one competitor.
// Plots where a shooter sits in the accuracy × speed space.
export interface StyleFingerprintStats {
  alphaRatio: number | null;        // total_A / (total_A + total_C + total_D); null when no zone data
  pointsPerSecond: number | null;   // total_points / total_time; null when total_time = 0
  penaltyRate: number | null;       // total_penalties / total_rounds_fired; null when no rounds fired
  // Raw totals (exposed for unit tests and tooltip display)
  totalA: number;
  totalC: number;
  totalD: number;
  totalPoints: number;
  totalTime: number;
  totalPenalties: number;
  totalRounds: number;
  stagesFired: number;
  /** Percentile rank vs full field, 0–100. Null until enriched in route.ts. */
  accuracyPercentile: number | null;
  /** Percentile rank vs full field, 0–100. Null until enriched in route.ts. */
  speedPercentile: number | null;
  /** Archetype derived from quadrant of (accuracyPercentile, speedPercentile). */
  archetype: ShooterArchetype | null;
  /** 100 − penaltyRate rank; 100 = fewest penalties in field. */
  composurePercentile: number;
  /** 100 − CV rank; 100 = most consistent stage-to-stage HF. Defaults to 50 when CV unavailable. */
  consistencyPercentile: number;
}

// Result of one what-if simulation scenario: replace the worst stage with
// a substitute performance and see what the match outcome would have been.
export interface SimResult {
  replacementPct: number; // group % used as the substitute for the worst stage
  matchPct: number;       // simulated avg group % after replacement
  totalPoints: number;    // simulated total match points after replacement
  groupRank: number;      // simulated rank within compared group (1-based)
  divRank: number | null;     // simulated rank within competitor's division (full field); null if unavailable
  overallRank: number | null; // simulated rank across all divisions (full field); null if unavailable
}

// What-if analysis for one competitor.
// null = fewer than 2 valid stages — no meaningful simulation is possible.
export interface WhatIfResult {
  competitorId: number;
  worstStageNum: number;        // stage_num of the identified worst stage
  worstStageGroupPct: number;   // actual group % on the worst stage
  actualMatchPct: number;       // actual avg group % across all valid stages
  actualTotalPoints: number;    // actual total match points
  actualGroupRank: number;      // actual rank within compared group
  actualDivRank: number | null;     // actual rank within competitor's division (full field); null if unavailable
  actualOverallRank: number | null; // actual rank across all divisions (full field); null if unavailable
  medianReplacement: SimResult;       // scenario 1: replace worst with competitor's median
  secondWorstReplacement: SimResult;  // scenario 2: replace worst with second-worst (lower bound)
}

export interface CompareResponse {
  match_id: number;
  stages: StageComparison[];
  competitors: CompetitorInfo[];
  penaltyStats: Record<number, CompetitorPenaltyStats>; // keyed by competitor_id
  efficiencyStats: Record<number, EfficiencyStats>;     // keyed by competitor_id
  consistencyStats: Record<number, ConsistencyStats>;   // keyed by competitor_id
  lossBreakdownStats: Record<number, LossBreakdownStats>; // keyed by competitor_id
  whatIfStats: Record<number, WhatIfResult | null>;     // keyed by competitor_id; null = not enough stages
  styleFingerprintStats: Record<number, StyleFingerprintStats>; // keyed by competitor_id
  fieldFingerprintPoints: FieldFingerprintPoint[]; // all match competitors (for cohort cloud)
  cacheInfo: CacheInfo;
}

// A match entry from the popular-matches API endpoint.
// Sourced from Redis cache — shows matches recently accessed by any user.
export interface PopularMatch {
  ct: string;
  id: string;
  name: string;
  venue: string | null;
  date: string | null;
  scoring_completed: number;
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

export interface ReleaseSection {
  heading: string;
  items: string[];
}

export interface Release {
  /** Unique release identifier — ISO date string, e.g. "2026-02-27". Used as the localStorage key. */
  id: string;
  /** Human-readable display date shown inside the dialog. */
  date: string;
  /** Optional short headline for the release, e.g. "Event Filters & More". */
  title?: string;
  sections: ReleaseSection[];
}
