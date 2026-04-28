// Single source of truth for all TypeScript interfaces.
// All fields that may be absent during an active match are nullable.

// Achievement types — imported here and re-exported at the bottom for convenience.
import type { AchievementProgress as _AchievementProgress } from "@/lib/achievements/types";

export interface MyShooterIdentity {
  shooterId: number;
  name: string;
  license: string | null;
}

export interface TrackedShooter {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
}

export interface StageInfo {
  id: number;
  name: string;
  stage_number: number;
  max_points: number;
  min_rounds: number | null;
  paper_targets: number | null;
  steel_targets: number | null;
  ssi_url: string | null;
  /** Official course-length classification set by the match director ("Short"/"Medium"/"Long"). */
  course_display: string | null;
  /** Full procedure text from the match director. Null if not set. */
  procedure: string | null;
  /** Firearm condition requirements (e.g. "Unloaded, hammer down"). Null if not set. */
  firearm_condition: string | null;
}

export interface CompetitorInfo {
  id: number;
  /** Globally stable ShooterNode primary key — same person across all matches. Null if unavailable. */
  shooterId: number | null;
  name: string;
  competitor_number: string;
  club: string | null;
  division: string | null;
  /** ISO 3166-1 alpha-3 nationality code for this match registration, e.g. "SWE". Null if unavailable. */
  region: string | null;
  /** Human-readable country name, e.g. "Sweden". Null if unavailable. */
  region_display: string | null;
  /** IPSC competition category code, e.g. "S" (Senior), "L" (Lady), "-" (Standard). Null if unavailable. */
  category: string | null;
  /** IPSC alias / ICS alias (member alias or numeric ID). Null if empty. */
  ics_alias: string | null;
  /** IPSC license / membership number. Null if empty. */
  license: string | null;
}

export interface SquadInfo {
  id: number;
  number: number;
  name: string;           // e.g. "Squad 1"
  competitorIds: number[]; // approved, non-DNF competitor IDs in this squad
}

export interface CacheInfo {
  cachedAt: string | null; // ISO string of when data was cached; null if just fetched fresh
  /** True when an upstream refresh failed within the last ~60s.
   *  Drives the "live updates paused" banner. Absent on fresh successful fetches. */
  upstreamDegraded?: boolean;
  /** ISO timestamp of the most recent scorecard the upstream knows about
   *  (max `scorecards.created` across the match). Used by the UI to surface
   *  a "data is N minutes old" indicator on ongoing matches even when the
   *  cache itself looks fresh. Absent when no scorecards have been recorded. */
  lastScorecardAt?: string | null;
}

export interface MatchResponse {
  name: string;
  venue: string | null;
  /** Latitude of the match venue; null if not set in SSI. */
  lat: number | null;
  /** Longitude of the match venue; null if not set in SSI. */
  lng: number | null;
  date: string | null;
  /** Match end date (ISO timestamp); null if not set. */
  ends: string | null;
  level: string | null;
  sub_rule: string | null;
  /** Human-readable discipline string, e.g. "IPSC Rifle", "IPSC Shotgun", "IPSC Handgun & PCC". */
  discipline: string | null;
  region: string | null;
  stages_count: number;
  competitors_count: number;
  /** Maximum number of competitors allowed; null if not set. */
  max_competitors: number | null;
  scoring_completed: number; // percentage 0-100
  /** SSI match lifecycle status: "dr" Draft | "on" Active | "ol" Active/no-self-edit | "pr" Preliminary | "cp" Completed | "cs" Cancelled */
  match_status: string;
  /** SSI results visibility: "org" organizers-only | "stg" scores-public | "cmp" participants-only | "all" publicly published */
  results_status: string;
  /** Registration status code: "op" open | "cl" closed | "ax" auto-approve on payment | "ox" waiting list + auto-approve | etc. */
  registration_status: string;
  /** When registration opens (ISO timestamp); null if not set. */
  registration_starts: string | null;
  /** When registration closes (ISO timestamp); null if not set. */
  registration_closes: string | null;
  /** Whether registration is currently possible. */
  is_registration_possible: boolean;
  /** When squadding opens (ISO timestamp); null if not set. */
  squadding_starts: string | null;
  /** When squadding closes (ISO timestamp); null if not set. */
  squadding_closes: string | null;
  /** Whether squadding is currently possible. */
  is_squadding_possible: boolean;
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
  // Raw competitor_division key used to index into StageComparison.divisionDistributions.
  // Matches the key used in RawScorecard.competitor_division (e.g. "Open", "Production").
  // Null when the competitor has no division or fired a DNF.
  divisionKey?: string | null;
  // Run quality classification based on HF% vs group leader, A%, and penalty counts.
  // null when there is insufficient data or the run is DNF.
  stageClassification: StageClassification | null;
  // Points left on table due to non-A hit quality (C/D/miss opportunity cost).
  // null when zone data (a_hits, c_hits, d_hits, miss_count) is unavailable, or for DNF/DQ/zeroed.
  hitLossPoints: number | null;
  // Points lost to penalties (miss + no_shoot + procedural × 10 each).
  // Always 0 for DNF; always ≥ 0 for fired stages.
  penaltyLossPoints: number;
  // ISO timestamp of when the scorecard was recorded (RO submission time).
  // Useful for editors aligning a stage run to a long video recording.
  // Null when the scorecard has no timestamp or this competitor did not fire the stage.
  scorecard_created?: string | null;
}

// Per-stage HF distribution for a single division.
// All percentage values are relative to the division leader's HF (0–100 scale).
// Competitors who DNF, DQ, or zero the stage are excluded.
export interface DivisionHFDistribution {
  /** Min HF as % of division leader. */
  minPct: number;
  /** Q1 (25th percentile) HF as % of division leader. */
  q1Pct: number;
  /** Median (50th percentile) HF as % of division leader. */
  medianPct: number;
  /** Q3 (75th percentile) HF as % of division leader. */
  q3Pct: number;
  /** Number of valid competitors contributing to this distribution. */
  count: number;
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
  /** Official course-length classification ("Short"/"Medium"/"Long"). */
  course_display?: string | null;
  /** Parsed constraint signals from procedure and firearm_condition. */
  constraints?: StageConstraints | null;
  group_leader_hf: number | null;     // best HF in selected group
  group_leader_points: number | null; // best raw pts in selected group — benchmark overlay hook, do not remove
  overall_leader_hf: number | null;   // best HF across full field — benchmark overlay hook
  field_median_hf: number | null;     // median HF across the full field (excludes DNF/DQ/zeroed)
  field_competitor_count: number;     // count of valid field competitors contributing to the median
  /** FEATURE: accuracy-metric — median(points/max_points×100) across valid field competitors. */
  field_median_accuracy: number | null;
  /** FEATURE: separator-metric — field CV (stddev/mean of HF). Higher = more field spread. */
  field_cv: number | null;
  stageDifficultyLevel: 1 | 2 | 3 | 4 | 5; // relative HF level: 1=very high HF, 5=very low HF
  stageDifficultyLabel: string;       // "Very high" / "High" / "Medium" / "Low" / "Very low"
  /** FEATURE: separator-metric — 1=low separator, 2=medium, 3=high (this stage spreads the field). */
  stageSeparatorLevel: 1 | 2 | 3;
  stageArchetype?: StageArchetype | null; // speed / precision / mixed — null when target data is insufficient
  competitors: Record<number, CompetitorSummary>; // keyed by competitor_id
  /** Per-division HF distribution (quartiles) for this stage. Keyed by competitor_division string. */
  divisionDistributions?: Record<string, DivisionHFDistribution>;
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

// Whether the compare API returns full coaching analytics or just live stage data.
// "live"     — active match; expensive analytics skipped for fast 30s polling
// "coaching" — post-match; full fingerprint, archetype, what-if, etc.
export type CompareMode = "live" | "coaching";

// View selection for the match page.
// "prematch" — squad rotation, weather, registered field (no scores yet, or user's squad
//              hasn't shot yet — useful when early squads have finished but the user is
//              in an afternoon/second-day squad).
// "live"     — fast-refresh comparison + charts; no heavy coaching analytics.
// "coaching" — full post-match analysis (style fingerprint, simulator, etc.).
export type MatchView = "prematch" | "live" | "coaching";

// View mode for the comparison table.
// "absolute" — shows raw hit factor, points, and percentage
// "delta"    — shows gap to the group leader per stage (±X.X pts)
// "stages"   — one mini-table per stage (SSI-style): each selected competitor
//              on its own row showing time, HF, A, C, D, NS, M, P
export type ViewMode = "absolute" | "delta" | "stages";

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

// Stage archetype based on target composition: speed (steel-heavy), precision
// (paper-heavy long course), or mixed.
export type StageArchetype = "speed" | "precision" | "mixed";

// Per-archetype performance aggregate for one competitor.
export interface ArchetypePerformance {
  archetype: StageArchetype;
  stageCount: number;
  avgGroupPercent: number | null;
  avgDivPercent: number | null;
  avgOverallPercent: number | null;
}

// Constraint signals parsed from stage procedure text and firearm_condition.
export interface StageConstraints {
  strongHand: boolean;      // /strong hand/i in procedure
  weakHand: boolean;        // /weak hand/i in procedure
  movingTargets: boolean;   // /moving target/i in procedure
  unloadedStart: boolean;   // /empty|unloaded/i in firearm_condition
}

// Per-course-length performance aggregate for one competitor.
// Same shape as ArchetypePerformance but keyed by course display string.
export interface CourseLengthPerformance {
  courseDisplay: string;        // "Short" | "Medium" | "Long"
  stageCount: number;
  avgGroupPercent: number | null;
  avgDivPercent: number | null;
  avgOverallPercent: number | null;
}

// Constrained vs normal stage performance for one competitor.
export interface ConstraintPerformance {
  normal: { stageCount: number; avgGroupPercent: number | null };
  constrained: { stageCount: number; avgGroupPercent: number | null };
}

export type ShooterArchetype = "Gunslinger" | "Surgeon" | "Speed Demon" | "Grinder";

// A single competitor's position in the style-fingerprint space, computed
// from raw scorecards across the full field (not only selected competitors).
// Used to render the background cohort cloud on the scatter chart.
export interface FieldFingerprintPoint {
  competitorId: number;
  division: string | null;   // division string (e.g. "Production", "Semi-Auto Open") for cohort filtering
  alphaRatio: number;        // total_A / (total_A + total_C + total_D)
  pointsPerSecond: number;   // total_points / total_time
  penaltyRate: number;       // total_penalties / total_rounds_fired
  /** Percentile rank within the full field, 0–100 (100 = best accuracy). */
  accuracyPercentile: number;
  /** Percentile rank within the full field, 0–100 (100 = fastest). */
  speedPercentile: number;
  cv: number | null;         // coefficient of variation of per-stage HF; null when < 2 stages
  /** Rank within competitor's division (1 = best); null when no valid data. */
  actualDivRank: number | null;
  /** Rank across all competitors regardless of division (1 = best); null when no valid data. */
  actualOverallRank: number | null;
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

// One competitor's shooting position vs performance on a specific stage (full field).
export interface StageDegradationPoint {
  competitorId: number;
  /** 1-based rank among all competitors who shot this stage, ordered by scorecard_created timestamp. */
  shootingPosition: number;
  /** HF as % of stage overall leader (0–100). */
  hfPercent: number;
}

// Full-field shooting order vs performance data for one stage.
// Used in the coaching analysis "Stage Degradation" chart.
export interface StageDegradationData {
  stageId: number;
  stageNum: number;
  stageName: string;
  /** All field competitors with valid timestamps and positive HF, sorted by shooting position. */
  points: StageDegradationPoint[];
  /** Spearman rank correlation between shooting position and HF%; null when < 4 valid data points. */
  spearmanR: number | null;
  /** Two-tailed t-test significance at α=0.05; null when spearmanR is null. */
  spearmanSignificant: boolean | null;
}

/** Historical weather data for a match day, fetched from Open-Meteo. */
export interface MatchWeatherData {
  /** Venue elevation in metres above sea level (from Open-Meteo 90 m DEM). */
  elevation: number;
  /** Match date (YYYY-MM-DD). */
  date: string;
  /** Temperature range [min, max] °C during match hours. */
  tempRange: [number, number] | null;
  /** Feels-like temperature range [min, max] °C during match hours. */
  apparentTempRange: [number, number] | null;
  /** Average relative humidity (%) during match hours. */
  humidityAvg: number | null;
  /** Average wind speed (m/s) during match hours. */
  windspeedAvg: number | null;
  /** Maximum wind gust (m/s) during match hours. */
  windgustMax: number | null;
  /** Dominant wind direction compass point during match hours. */
  winddirectionDominant: string | null;
  /** Total precipitation (mm) during match hours. */
  precipitationTotal: number | null;
  /** Average cloud cover (%) during match hours. */
  cloudcoverAvg: number | null;
  /** Average direct solar radiation (W/m²) during match hours. */
  solarRadiationAvg: number | null;
  /** WMO weather code representing dominant/worst conditions during match hours. */
  weatherCode: number | null;
  /** Human-readable label for weatherCode (e.g. "partly cloudy"). */
  weatherLabel: string | null;
  /** Maximum wet-bulb temperature (°C) during match hours — heat stress indicator. */
  wetbulbMax: number | null;
  /** Maximum snow depth (m) during match hours; null if no snow present. */
  snowDepthMax: number | null;
  /** Minimum visibility (m) during match hours. */
  visibilityMin: number | null;
  /** Sunrise time as "HH:MM" UTC. */
  sunrise: string | null;
  /** Sunset time as "HH:MM" UTC. */
  sunset: string | null;
  /** Total precipitation (mm) for the full calendar day. */
  precipitationDayTotal: number | null;
}

/**
 * Pre-match forecast response. Never a 5xx for date or geocoding issues —
 * unavailability is encoded as a structured 200 so the client renders a clear
 * empty-state instead of a generic error / retry loop.
 *
 * Open-Meteo's free forecast endpoint covers roughly today-90d through
 * today+16d; anything outside that returns `out_of_range_*`.
 */
export type PreMatchWeatherResponse =
  | { available: true; weather: MatchWeatherData }
  | {
      available: false;
      reason: "out_of_range_future";
      /** Days the user must wait before the forecast window opens for this date. */
      daysUntilWindow: number;
    }
  | { available: false; reason: "out_of_range_past" }
  | { available: false; reason: "no_coordinates" };

/** Per-cell conditions overlay for the comparison table (coaching mode only). */
export interface StageConditions {
  /** UTC hour (0–23) when this competitor shot this stage. */
  hourUtc: number;
  /** WMO weather code at that hour, or null if unavailable. */
  weatherCode: number | null;
  /** Human-readable weather label (e.g. "partly cloudy"), or null. */
  weatherLabel: string | null;
  /** Temperature (°C) at that hour, or null. */
  tempC: number | null;
  /** Wind speed (m/s) at that hour, or null. */
  windspeedMs: number | null;
  /** Wind gust speed (m/s) at that hour, or null. */
  windgustMs: number | null;
  /** Wind direction as compass point ("N", "NE", …), or null. */
  winddirectionDominant: string | null;
}

export interface CompareResponse {
  match_id: number;
  mode: CompareMode;
  stages: StageComparison[];
  competitors: CompetitorInfo[];
  penaltyStats: Record<number, CompetitorPenaltyStats>; // keyed by competitor_id
  efficiencyStats: Record<number, EfficiencyStats>;     // keyed by competitor_id
  consistencyStats: Record<number, ConsistencyStats>;   // keyed by competitor_id
  lossBreakdownStats: Record<number, LossBreakdownStats>; // keyed by competitor_id
  whatIfStats: Record<number, WhatIfResult | null> | null;     // null in live mode
  styleFingerprintStats: Record<number, StyleFingerprintStats> | null; // null in live mode
  fieldFingerprintPoints: FieldFingerprintPoint[] | null; // null in live mode
  archetypePerformance: Record<number, ArchetypePerformance[]> | null; // null in live mode
  courseLengthPerformance: Record<number, CourseLengthPerformance[]> | null; // null in live mode
  constraintPerformance: Record<number, ConstraintPerformance> | null; // null in live mode
  stageDegradationData: StageDegradationData[] | null; // null in live mode
  /** Per-stage per-competitor conditions (weather + time), coaching mode only. Keyed stageId → competitorId. */
  stageConditions: Record<number, Record<number, StageConditions>> | null;
  /**
   * Set when SSI reports scoring progress for the match but returns an empty
   * `scorecards` array. SSI gates per-shot detail on Level I (club) matches:
   * `scorecards_count` is exposed but the actual scorecard records are not.
   * The client should show a clear notice instead of an empty comparison.
   */
  scorecardsRestricted?: boolean;
  /**
   * IPSC match-point totals (anchors for division and overall match %):
   *   stage_points = (HF / division_stage_winner_HF) × stage.max_points
   *   match_points = sum across stages
   * The map is keyed by division string; values are the leader's total match
   * points within that division. `overallLeaderMatchPts` is the same figure
   * across the full field. The comparison-table totals row uses these as
   * denominators when computing each selected competitor's match %.
   */
  divisionLeaderMatchPts?: Record<string, number>;
  overallLeaderMatchPts?: number | null;
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
  /** Match end date (ISO timestamp); null if not set. */
  ends: string | null;
  status: string; // "on" | "cp" | "dr" | "cs" | "pr" | "ol"
  region: string;
  discipline: string; // e.g. "IPSC Handgun & PCC"
  level: string; // e.g. "Level II"
  /** Registration status code: "op" open | "cl" closed | "ax" auto-approve on payment | "ox" waiting list + auto-approve | etc. */
  registration_status: string;
  /** When registration opens (ISO timestamp); null if not set. */
  registration_starts: string | null;
  /** When registration closes (ISO timestamp); null if not set. */
  registration_closes: string | null;
  /** Whether registration is currently possible. */
  is_registration_possible: boolean;
  /** When squadding opens (ISO timestamp); null if not set. */
  squadding_starts: string | null;
  /** When squadding closes (ISO timestamp); null if not set. */
  squadding_closes: string | null;
  /** Whether squadding is currently possible. */
  is_squadding_possible: boolean;
  /** Maximum number of competitors allowed; null if not set. */
  max_competitors: number | null;
  /** Match scoring percentage (0-100). 0 for upcoming/empty matches. Used to
   *  surface "live now" matches whose scoring is in progress. Returned as a
   *  decimal string by SSI; the events route parses it to a number. */
  scoring_completed: number;
}

// ── Stage Simulator ──────────────────────────────────────────────────────────

// User-driven adjustments for the what-if stage simulator.
export interface StageSimulatorAdjustments {
  timeDelta:          number; // seconds added to current time (negative = faster)
  missToACount:       number; // 0 ≤ n ≤ miss_count
  missToCCount:       number; // 0 ≤ n ≤ miss_count − missToACount
  nsToACount:         number; // 0 ≤ n ≤ no_shoots
  nsToCCount:         number; // 0 ≤ n ≤ no_shoots − nsToACount
  cToACount:          number; // 0 ≤ n ≤ c_hits  (upgrade C-hits to A-hits)
  dToACount:          number; // 0 ≤ n ≤ d_hits
  dToCCount:          number; // 0 ≤ n ≤ d_hits − dToACount
  removedProcedurals: number; // 0 ≤ n ≤ procedurals
  aToCCount:          number; // 0 ≤ n ≤ a_hits  (trade: downgrade A-hits to C-hits)
  aToMissCount:       number; // 0 ≤ n ≤ a_hits − aToCCount
  aToNSCount:         number; // 0 ≤ n ≤ a_hits − aToCCount − aToMissCount
}

// Result of simulating a single stage after applying adjustments.
export interface SimulatedStageResult {
  stageId: number;
  newPoints: number;
  newTime: number;
  newHF: number;
  newGroupLeaderHF: number; // may equal newHF if competitor becomes leader
  newGroupPct: number | null;
  pointDelta: number;
  hfDelta: number;
  groupPctDelta: number | null;
}

// Match-level impact of a simulated stage adjustment.
export interface SimulatedMatchResult {
  newMatchPct: number | null;   // new avg group % across all valid stages
  matchPctDelta: number | null; // positive = improvement
  newGroupRank: number | null;  // rank among selected competitors
  groupRankDelta: number | null; // positive = rank improved (moved up)
}

// Request/response types for the POST /api/simulate endpoint.
export interface WhatIfSimulationRequest {
  ct: string;
  id: string;
  competitorId: number;
  adjustments: Record<number, StageSimulatorAdjustments>; // keyed by stageId
}

export interface WhatIfSimulationResponse {
  newMatchAvgDivPercent:     number | null;
  newMatchAvgOverallPercent: number | null;
  newDivRank:                number | null;
  newOverallRank:            number | null;
}

// ── Backfill ─────────────────────────────────────────────────────────────────

export type BackfillStatus = "scanning" | "checking" | "complete" | "error";

export interface BackfillProgress {
  status: BackfillStatus;
  /** Total cached match keys found via SCAN. */
  totalCached: number;
  /** Matches checked so far. */
  checked: number;
  /** Matches where shooter was found and newly indexed. */
  discovered: number;
  /** Matches already in shooter's index (skipped). */
  alreadyIndexed: number;
  errorMessage?: string;
}

// ── Match Domain Record ──────────────────────────────────────────────────────
// Structured match-level metadata stored in the `matches` domain table (D1/SQLite).
// Populated opportunistically when any user visits a match page or runs a comparison.
// Provides durable match identity for the shooter dashboard (especially upcoming matches
// whose full JSON blob expires from Redis and is not persisted to match_data_cache).

export interface MatchRecord {
  matchRef: string;            // PK — "22:26547" (ct:matchId)
  ct: number;
  matchId: string;
  name: string;
  venue: string | null;
  date: string | null;         // ISO 8601
  level: string | null;        // code: "1", "2", "3", "4", "5"
  region: string | null;       // code: "SWE", "NOR", "FIN"
  subRule: string | null;      // code: "ipsc_hs", "ipsc_rs", etc.
  discipline: string | null;   // display: "Handgun", "Rifle" (from get_full_rule_display)
  status: string | null;       // code: "on", "cs" (cancelled)
  resultsStatus: string | null; // code: "org", "all"
  scoringCompleted: number;
  competitorsCount: number | null;
  stagesCount: number | null;
  lat: number | null;
  lng: number | null;
  data: string | null;         // full raw GetMatch JSON blob (fallback)
  updatedAt: string;           // ISO 8601
  // Registration & squadding metadata (populated from GraphQL IpscMatchNode)
  registrationStarts: string | null;  // ISO 8601
  registrationCloses: string | null;  // ISO 8601
  registrationStatus: string | null;  // code: "op", "cl", etc.
  squaddingStarts: string | null;     // ISO 8601
  squaddingCloses: string | null;     // ISO 8601
  isRegistrationPossible: boolean;
  isSquaddingPossible: boolean;
  maxCompetitors: number | null;
}

// ── Upcoming Matches ──────────────────────────────────────────────────────────

export interface UpcomingMatch {
  ct: string;
  matchId: string;
  name: string;
  date: string | null;
  venue: string | null;
  level: string | null;
  division: string | null;
  competitorId: number;
  // Registration & squadding action context
  registrationStarts: string | null;
  registrationCloses: string | null;
  isRegistrationPossible: boolean;
  squaddingStarts: string | null;
  squaddingCloses: string | null;
  isSquaddingPossible: boolean;
  /** True when the shooter appears in the competitor list. */
  isRegistered: boolean;
  /** True when the shooter is assigned to a squad. */
  isSquadded: boolean;
}

// ── Shooter Dashboard ─────────────────────────────────────────────────────────

// Per-match summary for the shooter dashboard.
export interface ShooterMatchSummary {
  ct: string;
  matchId: string;
  name: string;
  date: string | null;
  venue: string | null;
  level: string | null;
  /** Region/country of the match (e.g. "Sweden"). */
  region: string | null;
  /** Division the shooter competed in for this match (may differ between matches). */
  division: string | null;
  /** Competitor ID within this specific match. */
  competitorId: number;
  /** Number of approved (non-DNF) competitors in the same division for this match. Null if unavailable. */
  competitorsInDivision: number | null;
  /** Number of stages the shooter fired (non-DNF, non-DQ). */
  stageCount: number;
  /** Mean hit factor across valid stages. Null if no valid stages. */
  avgHF: number | null;
  /**
   * Official IPSC match percentage within the shooter's division (0–100):
   * (my_match_points / division_leader_match_points) × 100, where
   * stage_points = (HF / division_stage_winner_HF) × stage.max_points.
   * Mirrors the percentage shown on shootnscoreit.com. Null when the shooter
   * has no valid scorecards or division is unknown. Falls back to a simple
   * average of per-stage division percentages when stage max_points is
   * missing on older cached entries.
   */
  matchPct: number | null;
  /** Raw hit-zone totals across all valid stages. */
  totalA: number;
  totalC: number;
  totalD: number;
  totalMiss: number;
  totalNoShoots: number;
  totalProcedurals?: number;
  dq?: boolean;
  /** Number of stages with all A-hits and no penalties (C/D/miss/no-shoot/procedural). */
  perfectStages?: number;
  /**
   * Consistency index for this match: (1 − CV) × 100, where CV = stddev(stageHFs) / mean(stageHFs).
   * Higher is better — 100 means every stage had the same hit factor.
   * Null when fewer than 2 valid stages or mean HF is zero.
   */
  consistencyIndex?: number | null;
  /** Global shooter IDs of competitors who shared a squad with this shooter. Empty if squad data unavailable or shooter was unassigned. */
  squadmateShooterIds?: number[];
  /** True when every squad member (including the shooter) who has a club listed share the same club, and at least 2 members have club data. False/absent otherwise. */
  squadAllSameClub?: boolean;
  /** Human-readable discipline string, e.g. "IPSC Rifle", "IPSC Shotgun", "IPSC Handgun & PCC". Null if unavailable. */
  discipline?: string | null;
}

// Cross-match aggregate statistics for the shooter dashboard.
export interface ShooterAggregateStats {
  /** Total non-DNF stages shot across all cached matches. */
  totalStages: number;
  /** ISO date range of cached matches. Null edges when no dates available. */
  dateRange: { from: string | null; to: string | null };
  /** Weighted mean HF across all valid stages from all matches. Null when no data. */
  overallAvgHF: number | null;
  /** Mean of per-match matchPct values. Null when no scorecard data. */
  overallMatchPct: number | null;
  /** A-zone % of total shot hits (A+C+D+miss). Null when no zone data. */
  aPercent: number | null;
  /** C-zone %. */
  cPercent: number | null;
  /** D-zone %. */
  dPercent: number | null;
  /** Miss % of total shots. */
  missPercent: number | null;
  /** Coefficient of variation of per-match avg HF (σ/μ). Lower = more consistent. Null when < 2 matches with HF data. */
  consistencyCV: number | null;
  /** Linear regression slope on avg HF over time. Positive = improving. Null when < 3 data points. */
  hfTrendSlope: number | null;
  /** Mean penalty rate across matches: avg((miss+noShoots+procedurals) / totalShots). Null when no shot data. */
  avgPenaltyRate?: number | null;
  /** Mean consistency index across matches. Null when no data. */
  avgConsistencyIndex?: number | null;
}

// Response from GET /api/shooter/{shooterId}.
export interface ShooterDashboardResponse {
  shooterId: number;
  /** Shooter's latest known profile. Null if no profile has been indexed yet. */
  profile: {
    name: string;
    club: string | null;
    division: string | null;
    lastSeen: string;
    region: string | null;
    region_display: string | null;
    category: string | null;
    ics_alias: string | null;
    license: string | null;
  } | null;
  /** Total number of matches in the Redis index for this shooter (may exceed matches.length). */
  matchCount: number;
  /** Up to 50 most recent matches, sorted newest first. */
  matches: ShooterMatchSummary[];
  stats: ShooterAggregateStats;
  /** Matches with start_timestamp in the future. Only present when non-empty. */
  upcomingMatches?: UpcomingMatch[];
  /** Achievement progress (preview feature). */
  achievements?: _AchievementProgress[];
}

// Response from GET /api/shooter/search.
export interface ShooterSearchResult {
  shooterId: number;
  name: string;
  club: string | null;
  division: string | null;
  /** ISO timestamp of the last match this shooter was seen in. */
  lastSeen: string;
}

// Re-export achievement types for convenience.
export type {
  AchievementProgress,
  AchievementTier,
  AchievementDefinition,
  AchievementCategory,
  UnlockedTier,
  StoredAchievement,
} from "@/lib/achievements/types";

// ── AI Coaching Tips ─────────────────────────────────────────────────────────

export interface CoachingTipResponse {
  tip: string;                // 1–2 sentence coaching insight
  generatedAt: string;        // ISO timestamp of generation
  model: string;              // model identifier used (e.g. "@cf/meta/llama-3.1-8b-instruct")
  competitorId: number;
  matchId: string;
  ct: string;
}

export interface CoachingAvailability {
  available: boolean;         // true if AI provider is configured
}

// ── Device Sync ──────────────────────────────────────────────────────────────

/** Payload transferred between devices via the sync feature. */
export interface SyncPayload {
  /** Schema version for forward compatibility. */
  version: 1;
  identity: MyShooterIdentity | null;
  tracked: TrackedShooter[];
  recentCompetitions: Array<{
    ct: string;
    id: string;
    name: string;
    venue: string | null;
    date: string | null;
    scoring_completed: number;
    last_visited: number;
  }>;
  /** Per-match competitor selections, keyed by "ssi_competitors_{ct}_{id}". */
  competitorSelections: Record<string, number[]>;
  /** Per-match display mode overrides, keyed by "ssi_mode_{ct}_{id}". */
  modeOverrides: Record<string, string>;
  /** Event search filter preferences. */
  eventFilters: { level: string; firearms: string; country: string } | null;
}

/** Stats summary for the sync preview UI. */
export interface SyncStats {
  hasIdentity: boolean;
  trackedCount: number;
  recentCount: number;
  selectionsCount: number;
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
  /**
   * Scene names to capture when generating release screenshots.
   * References the canonical scene catalogue in scripts/screenshot-match.ts.
   * Omit to capture all scenes (fallback).
   */
  screenshotScenes?: string[];
}
