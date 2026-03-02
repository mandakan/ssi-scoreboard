# Stage Metrics

This document explains the three per-stage metrics shown in the comparison table. All three are computed from the full field of competitors (not just the ones you have selected).

---

## 1. HF Level (relative hit factor tier)

**What it is:** A 1–5 bar indicator showing where this stage sits relative to the other stages in the match in terms of the field median hit factor. It is a measure of *how fast the field shoots* this stage, not of how technically difficult it is.

**Formula:**

```
score[s] = 1 − (field_median_hf[s] / max(field_median_hf[]))
level[s] = tier(score[s])   # 1–5 via band mapping
```

Stages with the highest field median get level 1 ("Very high"); those with the lowest field median get level 5 ("Very low").

**Band mapping:**

| Normalised score | Level | Label |
|---|---|---|
| 0.0–0.2 | 1 | Very high |
| 0.2–0.4 | 2 | High |
| 0.4–0.6 | 3 | Medium |
| 0.6–0.8 | 4 | Low |
| 0.8–1.0 | 5 | Very low |

**How to read the 5 bars:** More bars filled in = this stage has a *lower* field median HF relative to other stages. Fewer bars = the field shoots this stage fast relative to the rest of the match.

**What "low HF" can mean:**
- Long running distances or transitions
- High round count (more time spent shooting)
- Hard shots (distant/small targets)
- Procedural requirements that slow the field down

A low HF Level alone does not tell you *why* the field is slower. Use Field Accuracy alongside it to distinguish "field is missing targets" from "field is running far".

**Edge cases:**
- All stages have equal median HF → all get level 3 (Medium)
- Fewer than 2 valid stages → level 3 (Medium)
- Stage with null median (no valid scorecards yet) → level 3 (Medium)

**Raw fields exposed on `StageComparison`:**
- `field_median_hf` — the median HF value used in the formula
- `field_competitor_count` — number of valid (non-DNF/DQ/zeroed) competitors included

---

## 2. Field Accuracy Rate *(FEATURE: accuracy-metric)*

> These fields and the UI elements that display them are tagged `// FEATURE: accuracy-metric`. Remove all tagged lines to cleanly revert this feature.

**What it is:** The median of `(points / max_points × 100)` across all valid field competitors on this stage. Represents how much of the available points the median competitor scores — a proxy for *shooting accuracy*, independent of speed.

**What "valid" means:** Excludes competitors who DNF, DQ, zeroed, or whose scorecard has `scorecard_created = null` (not yet submitted).

**Formula:**

```
accuracy[competitor] = (points / max_points) × 100
field_median_accuracy[stage] = median(accuracy[all valid competitors])
```

**Interpretation:**

| Field Accuracy | HF Level | Likely cause |
|---|---|---|
| High | High | Easy, fast stage |
| High | Low | Stage is long/slow — field is accurate but not fast |
| Low | High | Stage is short with forgiving geometry — even with misses, speed wins |
| Low | Low | Stage is technically demanding — field is both slow and inaccurate |

Use this alongside HF Level to distinguish stages where low HF comes from movement/round count versus hard shots.

**Edge cases:**
- Returns `null` when no valid scorecards exist with `scorecard_created` set
- Displayed as `null` (hidden) in the UI when unavailable

**Raw field:** `field_median_accuracy` on `StageComparison` (number | null)

---

## 3. Stage Separator *(FEATURE: separator-metric)*

> These fields and the UI elements that display them are tagged `// FEATURE: separator-metric`. Remove all tagged lines to cleanly revert this feature.

**What it is:** Indicates whether this stage *spreads the field apart* in terms of hit factor. High-separator stages are where rank positions are won and lost; low-separator stages are where the field performs similarly.

**Formula:**

```
CV[stage]   = stddev(field HFs) / mean(field HFs)   # coefficient of variation
mean_cv     = mean(CV[all stages])
σ_cv        = stddev(CV[all stages])

level 3 if CV > mean_cv + σ_cv   # clear outlier — spreads field more than the pack
level 1 if CV < mean_cv − σ_cv   # clear outlier — field unusually clustered
level 2 otherwise                 # within one standard deviation of the average
```

**Classification:**

| CV relative to match mean | Level | Meaning |
|---|---|---|
| > mean + 1σ | 3 | High separator — genuinely above-average spread ↕ |
| within ±1σ | 2 | Typical spread for this match |
| < mean − 1σ | 1 | Unusually clustered — field performs similarly |

Level 3 stages are flagged with a `↕` (`ArrowUpDown`) icon in the comparison table.

**Key property:** if all stages have similar CVs (small σ), **no stage gets flagged** — the icon only appears when a stage is a genuine statistical outlier within the match. In a typical 8-stage match this means 0–2 stages carry the icon.

**Why this matters:** High-separator stages are the stages that most affect match outcomes. If you want to improve your overall placement, focus your coaching analysis on stages where CV is highest. A "clean" run on a high-separator stage yields more rank improvement than an equivalent improvement on a low-separator stage.

**Minimum requirement:** At least 4 valid (non-DNF/DQ/zeroed) competitors with positive hit factor. Stages with fewer than 4 valid competitors return `field_cv = null` and are displayed as level 2 (no icon).

**Raw fields on `StageComparison`:**
- `field_cv` — the raw coefficient of variation (number | null)
- `stageSeparatorLevel` — classified level (1 | 2 | 3)

---

## Raw fields reference (for developers)

All fields live on the `StageComparison` interface in `lib/types.ts`. Computed in `app/api/compare/logic.ts` — first pass computes per-stage values, second pass assigns relative HF levels and separator levels across all stages.

| Field | Type | Description | Nullable |
|---|---|---|---|
| `field_median_hf` | `number \| null` | Median HF across valid field competitors | Yes (no valid scorecards) |
| `field_competitor_count` | `number` | Count of valid competitors in median | No (0 when none) |
| `field_median_accuracy` | `number \| null` | Median accuracy % across valid field competitors | Yes |
| `field_cv` | `number \| null` | CV of field HFs (stddev/mean); null when < 4 valid competitors | Yes |
| `stageDifficultyLevel` | `1 \| 2 \| 3 \| 4 \| 5` | Relative HF level tier (1=very high, 5=very low) | No |
| `stageDifficultyLabel` | `string` | Human-readable label ("Very high" … "Very low") | No |
| `stageSeparatorLevel` | `1 \| 2 \| 3` | Separator classification (1=low, 3=high) | No |
