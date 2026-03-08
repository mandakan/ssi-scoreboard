# Rating Algorithms — Technical Reference

This document describes every rating algorithm in the SSI scoreboard lab:
plain-language explanations for practitioners, mathematical formulations for
researchers, data quality considerations, and the automated tuning methodology.

---

## Table of Contents

1. [The core idea: what is a skill rating?](#the-core-idea-what-is-a-skill-rating)
2. [How performance is measured in IPSC](#how-performance-is-measured-in-ipsc)
3. [Scoring modes](#scoring-modes)
4. [The algorithms](#the-algorithms)
   - [ELO — the classic baseline](#elo-elo--the-classic-baseline)
   - [OpenSkill Plackett-Luce](#openskill-plackett-luce-openskill--the-full-ranking-model)
   - [OpenSkill BradleyTerry Partial](#openskill-bradleyterry-partial-openskill_bt--the-pairwise-bayesian-model)
   - [BradleyTerry with Level-Scaled Beta](#bradleyterry-with-level-scaled-beta-openskill_bt_lvl)
   - [Plackett-Luce with Inactivity Decay](#plackett-luce-with-inactivity-decay-openskill_pl_decay)
   - [BradleyTerry with Level Scaling + Decay](#bradleyterry-with-level-scaling--decay-openskill_bt_lvl_decay)
5. [Conservative ranking](#conservative-ranking-cons)
6. [Cross-division fairness](#cross-division-fairness)
7. [Data quality and identity resolution](#data-quality-and-identity-resolution)
8. [Benchmark methodology](#benchmark-methodology)
9. [Automated hyperparameter tuning](#automated-hyperparameter-tuning)
10. [Summary table](#summary-table)
11. [Attribution](#attribution)

---

## The core idea: what is a skill rating?

A rating system tries to answer one question: *given what we've seen before, how good
is this person?*

Every algorithm in this lab boils down to two numbers per shooter:

- **mu (the Greek letter is written as the symbol for mean)** — the best guess of their skill level. Higher = better.
- **sigma** — how confident we are in that guess. Lower = more certain.

When a shooter first appears in the system they start at default values (mu = 25,
sigma = 25/3 = 8.333). Every match they compete in moves their mu up or down and
(usually) reduces their sigma, because we now have more evidence. After enough matches
their rating stabilises.

### Mathematical notation

Throughout this document we use:

| Symbol | Meaning |
|---|---|
| mu_i | Skill estimate (mean) for shooter i |
| sigma_i | Uncertainty (standard deviation) for shooter i |
| beta | Performance variability parameter (noise per contest) |
| tau | Sigma drift rate per inactive day |
| K | ELO K-factor (learning rate) |
| z | Conservative ranking z-score (percentile) |
| n | Number of competitors on a stage |

---

## How performance is measured in IPSC

For each stage, competitors are ranked by **hit factor** (points scored divided by time).
The algorithm sees: shooter A got 5.0 HF, shooter B got 3.0 HF — A outperformed B on
this stage. DQ and zeroed shooters are treated as HF = 0 (ranked last). Shooters who
did not fire a stage (DNF) are excluded from that stage's calculation.

Each stage is treated as a separate, independent competition event. A match with 10 stages
gives 10 separate data points per shooter, which is much richer than treating the whole
match as a single result.

---

## Scoring modes

The system supports two distinct modes for converting raw match data into rating inputs.
Each mode sees different "events" and produces different quality signals:

### Stage HF (stage_hf)

Each stage is a separate ranking event. Competitors are ordered by hit factor within
their division. A 10-stage match produces 10 independent data points per shooter.

**Advantages:** Maximum data granularity — each stage provides an independent skill
signal. Captures stage-to-stage consistency.

**Disadvantages:** Treats all stages equally regardless of difficulty. A short classifier
(2 seconds) carries the same weight as a 30-round field course (40 seconds). A bad draw
on one stage can disproportionately affect multiple data points.

### Match Percentage (match_pct)

The entire match is treated as one ranking event. Each competitor's metric is their
total match points (sum across all stages). This aligns with IPSC's official scoring:
the overall match result determines the ranking.

**Advantages:** Directly mirrors how IPSC officially ranks competitors. Smooths out
stage-level noise — a bad classifier is offset by strong field courses. One holistic
signal per match.

**Disadvantages:** Fewer data points per match (1 vs N stages). Less granular — cannot
distinguish between "consistently mediocre" and "brilliant on 9 stages, DQ on 1".

### Which to use?

For **national team selection** (the primary use case), `match_pct` is recommended
as the default because it aligns with how matches are officially scored and how
selectors think about performance. A shooter's overall match result — not individual
stage hit factors — determines standings in real competitions.

`stage_hf` remains available for research and may perform better on certain metrics
due to higher data volume per match.

---

## The algorithms

### ELO (`elo`) — the classic baseline

**What it is:** The same system used in chess and FIFA football rankings. Each stage
result is broken into a series of head-to-head comparisons: A vs B, A vs C, B vs C,
and so on. If you beat someone you were "expected" to beat, your rating barely moves.
If you beat someone rated much higher, your rating jumps.

#### Mathematical formulation

Each competitor maintains a single rating R (default: 1500). For a pairwise comparison
between competitors A and B:

**Expected score:**

    E(A) = 1 / (1 + 10^((R_B - R_A) / 400))

This is the logistic function — the probability that A beats B given their rating
difference. A 400-point gap means the stronger player wins ~91% of the time.

**Rating update (per pair):**

    R_A' = R_A + K * (S_A - E(A)) / n

where:
- S_A = 1 if A's HF > B's HF, 0.5 if tied, 0 if A lost
- K = K-factor (learning rate, see below)
- n = number of competitors on the stage (scaling factor to prevent over-updating)

**K-factor decay:**

    K(m) = K_default - (K_default - K_min) * min(m / m_decay, 1)

where m is the number of matches played. K decays linearly from K_default (32) to
K_min (16) over m_decay (20) matches. This makes new shooters' ratings more responsive
to results while stabilising experienced shooters.

**Tunable parameters:**

| Parameter | Default | Range tested | What it controls |
|---|---|---|---|
| K_default | 32 | 24, 32, 40, 48 | Initial learning rate |
| K_min | 16 | 8, 12, 16 | Floor learning rate for veterans |
| K_decay_matches | 20 | 15, 20, 30 | Matches until K reaches floor |

**Strengths:**
- Very simple and well-understood — 60 years of real-world use
- Handles large fields reasonably well through pairwise comparisons
- Produces a single number that is easy to explain

**Weaknesses:**
- No concept of uncertainty. A shooter who has competed in 2 matches is treated with the
  same confidence as someone who has competed in 200. This makes it unfair for national
  team selection.
- All matches are treated equally regardless of level or field size.
- Cannot naturally handle ties in hit factor (uses 0.5 as a tie score, which is approximate).

**Why include it?** It's the gold standard baseline. If a fancier algorithm can't beat ELO,
it's not worth using.

---

### OpenSkill Plackett-Luce (`openskill`) — the full-ranking model

**What it is:** A modern Bayesian skill rating system. Instead of pairwise comparisons
like ELO, it models the *probability of a full finishing order*. "Given everyone's
ratings, how likely is it that A finished first, B second, C third...?" The ratings
are then updated to make observed results more probable in hindsight.

"Bayesian" means the system maintains genuine uncertainty (sigma) and updates it
mathematically as evidence accumulates. Sigma naturally shrinks with more matches and
grows if the system is surprised by an outcome.

#### Mathematical formulation

Each competitor i is modelled by a Gaussian belief:

    skill_i ~ N(mu_i, sigma_i^2)

The Plackett-Luce model defines the probability of an observed ranking
(1st, 2nd, ..., n-th) as:

    P(ranking) = product over k=1..n of: p_k / sum over j=k..n of p_j

where p_i = exp(mu_i / beta) is the "strength" of competitor i and beta is the
noise parameter (default: sigma_0 / 2 = 25/6 = 4.167).

Intuitively: the probability that competitor k finishes in position k is their
strength divided by the total remaining strength of everyone who hasn't placed yet.

**Bayesian update:** After observing results, the posterior belief for each
competitor is computed via approximate message passing (the OpenSkill library uses
factor graphs). The update adjusts both mu (skill estimate) and sigma (uncertainty):

- Beating stronger opponents increases mu more
- Sigma decreases when results match predictions (evidence confirms the estimate)
- Sigma increases when the model is surprised

**Parameters:** Uses OpenSkill library defaults (mu=25, sigma=25/3, beta=25/6).
No special configuration — this is the plain off-the-shelf model.

**Strengths:**
- Mathematically well-founded — uncertainty is real and meaningful
- Sigma shrinks naturally with experience, giving more reliable estimates for veteran shooters
- Captures the full ranking at once rather than simulating pairwise comparisons

**Weaknesses:**
- All matches treated equally (a club regional has the same weight as the World Shoot)
- No concept of time or recency — a shooter who last competed 3 years ago has the same
  sigma as one who competed last weekend
- Notably worse at identifying top performers than the BT model in our tests — possibly
  because Plackett-Luce's "full ranking" model is more sensitive to noise from the large
  mixed-division fields in our data

**Why include it?** It's the starting point we built everything else on.

---

### OpenSkill BradleyTerry Partial (`openskill_bt`) — the pairwise Bayesian model

**What it is:** The same Bayesian framework as Plackett-Luce, but uses a different
underlying model called Bradley-Terry. Instead of modelling the full finishing order
at once, it models a series of pairwise match-ups. For a stage with 100 competitors,
BT internally considers roughly 4,950 pairings (every possible pair) and updates
based on who won each one.

"Partial" means it uses an approximation that is faster to compute while keeping
most of the accuracy.

#### Mathematical formulation

The Bradley-Terry model defines the probability that competitor i beats competitor j as:

    P(i beats j) = p_i / (p_i + p_j)

where p_i = exp(mu_i / beta). This is the logistic function applied to the rating
difference, identical in form to ELO's expected score but embedded in a Bayesian
framework with proper uncertainty tracking.

For a full stage ranking, the likelihood is the product of all pairwise outcomes:

    L = product over all pairs (i,j) where i ranked above j of: P(i beats j)

The "Partial" variant approximates the full posterior update using a subset of pairs,
making it computationally tractable for large fields while preserving most accuracy.

**Parameters:** Same OpenSkill defaults as above, no special configuration.

**Strengths:**
- Same uncertainty (sigma) benefits as Plackett-Luce
- Significantly better at identifying top performers in our tests — the pairwise
  approach seems better suited to the large, noisy, mixed-division IPSC fields
- Better MRR — the actual top shooters appear higher in the predicted list

**Weaknesses:**
- Still treats all matches equally
- Still no recency / inactivity handling
- Like all Bayesian models, it needs enough match history before ratings stabilise

**Why include it?** BT substantially outperforms PL at the top end. For national team
selection (where you care most about correctly identifying the very best), BT is
clearly the better base model.

---

### BradleyTerry with Level-Scaled Beta (`openskill_bt_lvl`)

**What it is:** Identical to `openskill_bt` but with one extra rule: the *weight* of
each match result depends on the match level.

#### What is beta?

Beta controls how "noisy" a single match result is assumed to be. A small beta says:
"outcomes are very predictable — skill differences show up clearly in results." A large
beta says: "anything can happen in one match — even a weak shooter can beat a strong
one by luck." Higher beta = each match result changes ratings less. Lower beta = each
match changes ratings more.

#### Level-scaled beta values

The base beta values scale by match level. A configurable `level_scale` multiplier
(default: 1.0) is applied uniformly:

    beta_effective(level) = base_beta(level) * level_scale

| Level | Base beta | Derivation | What this means |
|---|---|---|---|
| L2 (regional) | mu/12 = 2.08 | Half of default | Results treated as fairly reliable |
| L3 (national) | mu/6 = 4.17 | Near default (sigma/2) | Moderate result influence |
| L4 (continental) | mu/3 = 8.33 | 2x default | Higher uncertainty per result |
| L5 (world) | mu/1.5 = 16.67 | 4x default | Large field, high variance assumed |

*These values are adapted from Jonas Emilsson's ipsc-ranking project — see attribution.*

**Intuition:** At a World Shoot, 700+ competitors from everywhere compete. The sheer
size and mix means a single result is quite "noisy" — great shooters can have off days,
unknown quantities can surprise everyone. At a smaller regional with familiar competitors,
results are more predictable.

**Tunable parameters:**

| Parameter | Default | Range tested | What it controls |
|---|---|---|---|
| level_scale | 1.0 | 0.5, 0.75, 1.0, 1.25, 1.5, 2.0 | Multiplier on all beta values |

A `level_scale` of 0.5 halves all betas (making all results more impactful). A value
of 2.0 doubles them (making all results less impactful, especially at lower levels).

**Strengths:**
- Treats higher-level results more carefully (less volatile updates from one big result)
- Logically appealing for national team selection: a World Shoot result *should* be weighted
  differently than a club match

**Weaknesses:**
- The specific beta values are educated guesses — they may need tuning (hence level_scale)
- Same lack of recency handling as plain BT

---

### Plackett-Luce with Inactivity Decay (`openskill_pl_decay`)

**What it is:** Same as the base `openskill` model, but when a shooter reappears after
a long gap, their sigma is deliberately increased before their rating is updated.

#### Mathematical formulation

Before processing a match, for each competitor i with days_gap since their last match:

    sigma_i' = min(sigma_i + tau * days_gap, sigma_default)

where:
- tau = 25/300 = 0.0833 (default) — sigma drift per inactive day
- sigma_default = 25/3 = 8.333 — the ceiling (initial uncertainty)

This is a linear decay model: uncertainty grows proportionally to absence. A shooter
absent for 30 days gains about 2.5 extra sigma. A shooter absent for 100+ days
drifts back to the default starting sigma (as if we barely know them anymore). After
they compete again, sigma will start falling as usual.

*The decay formula is adapted from Jonas Emilsson's ipsc-ranking project — see attribution.*

**Tunable parameters:**

| Parameter | Default | Range tested | What it controls |
|---|---|---|---|
| tau | 0.0833 (25/300) | 0.04, 0.06, 0.083, 0.10, 0.12, 0.15 | Sigma drift per inactive day |

Lower tau = slower decay (a shooter can be absent longer before their rating becomes
uncertain). Higher tau = faster decay (even short absences increase uncertainty).

**Why this matters for national team selection:** If someone dominated 3 years ago but
hasn't competed since, should they be near the top of a national ranking? Probably not.
Their sigma should have grown, and when they return, a few good results will bring it
back down quickly. Without decay, old results lock in a high mu indefinitely.

**Strengths:**
- Recency matters — active shooters get more reliable ratings
- Protects against "ghost rankings" where retired shooters block active ones

**Weaknesses:**
- Decay can hurt if elite shooters tend to compete less often between major matches —
  they accumulate sigma between events

---

### BradleyTerry with Level Scaling + Decay (`openskill_bt_lvl_decay`)

**What it is:** The "kitchen sink" model — combines BT model + level-scaled beta +
inactivity decay. All three ideas at once.

**Tunable parameters:** Combines both level_scale (6 values) and tau (6 values) for
36 combinations in the grid search.

**Strengths:**
- Most principled for long-term national ranking: level weighting + recency + BT accuracy
- Good balance across all metrics

**Weaknesses:**
- More complex than simpler models — harder to debug if something behaves unexpectedly
- The decay can slightly hurt identification of the very top shooters (see discussion below)

**Why does decay sometimes hurt Top-5 accuracy?** A hypothesis: elite shooters compete
at fewer matches (they focus on major events). Between a big match and the next one,
their sigma grows due to inactivity. When the benchmark tries to predict the next match,
some of these elites have a temporarily higher sigma, and the conservative ranking
pushes them down slightly. The decay is "working as intended" from a fairness standpoint
but is a real limitation in the benchmark's test window.

---

## Conservative ranking (+cons)

Every algorithm above produces two ranking signals:

1. **Base ranking** — sorted by mu alone. Simple and fast.
2. **Conservative ranking (+cons)** — sorted by mu - z * sigma. This is the "70th
   percentile" estimate: we're 70% confident the shooter's true skill is *at least
   this high.*

### Mathematical formulation

The conservative rating (CR) for shooter i is:

    CR_i = mu_i - z * sigma_i

where z = 0.5244 corresponds to the 70th percentile of a standard normal distribution
(i.e., Phi^(-1)(0.70) = 0.5244, where Phi is the standard normal CDF).

**Why 70th percentile?** The choice of z balances two competing concerns:

- **Too low (e.g. 50th, z=0):** Degenerates to base mu ranking. No penalty for
  uncertainty — shooters with 2 matches are ranked alongside veterans.
- **Too high (e.g. 95th, z=1.645):** Excessively penalises new competitors. A talented
  shooter who has only competed in 3 matches could be ranked 50th even with consistently
  excellent results.

The 70th percentile (z=0.5244) provides a meaningful but moderate penalty: it rewards
consistent performance without being too harsh on newer competitors.

**Example:**

- Alice: mu=28, sigma=4 (many matches, consistent) -> CR = 28 - 0.52*4 = 25.9
- Bob: mu=30, sigma=9 (few matches, inconsistent) -> CR = 30 - 0.52*9 = 25.3

Base ranking puts Bob first. Conservative ranking puts Alice first. For national team
selection, Alice is the safer pick — she has demonstrated sustained excellence. Bob
might be great but might also have had two lucky matches.

**Note on ELO:** Since ELO has sigma=0, the conservative and base rankings are
identical. Conservative ranking only differentiates results for Bayesian algorithms
(OpenSkill variants).

---

## Cross-division fairness

The per-division breakdown in the benchmark reports Kendall tau *within each division*.
This answers: "for Production shooters specifically, does this algorithm correctly rank
them relative to each other?"

**The core challenge:** Ratings are calibrated against people you've competed against.
If Anton (Production) and Erik (Standard) compete in the same match, the algorithm can
directly compare them via shared stage results. But if they *never* appear in the same
match, the comparison is only possible through chains: "Anton beat Lars who beat Mikael
who beat Erik."

All the algorithms handle this implicitly — the ratings live on the same scale and
update based on shared competition. But if certain divisions rarely mix (e.g. a
junior-only regional), cross-division calibration will be weaker.

The per-division tau table shows if any algorithm is systematically biased — if one
division consistently gets lower tau than others, that division is being mis-ranked
and the algorithm is less trustworthy for team selection from that division.

---

## Data quality and identity resolution

The quality of any rating system is bounded by the quality of its input data. This
section describes the data pipeline, its known limitations, and how they are measured.

### Data sources

| Source | Coverage | Levels | Identification | Since |
|---|---|---|---|---|
| SSI (ShootNScoreIt) | Swedish matches | L2-L3 | Stable integer shooter_id | Recent |
| ipscresults.org | International (global) | L3-L5 | Name + region only | 2009 |

### Identity resolution pipeline

Since ipscresults.org has no global shooter IDs, linking competitors across sources
requires name matching. The pipeline runs in three phases:

**Phase 1: Bootstrap SSI identities**

Each SSI `shooter_id` becomes a `canonical_id` (the universal identity key). All name
variants observed for a given shooter_id are registered as fingerprints. This is a
clean, high-confidence process since SSI provides stable integer IDs.

**Phase 2: Link ipscresults competitors**

For each unlinked (name, region) pair from ipscresults:

1. **Name normalisation:** "Last, First" format is reversed to "First Last". Diacritics
   are stripped (e.g. Sjoberg from Sjöberg, Sasa from Saša) using both NFD decomposition
   and a manual mapping for non-decomposing Nordic characters (O from Ø, AE from Æ, A from Å, ss from ß).
   Purely numeric middle tokens are removed (e.g. "Anders 1406 Svensson" becomes
   "Anders Svensson" — registration numbers embedded in names). The result is
   lowercased and combined with the region to form a fingerprint:
   `"normalized name|REGION"`.

2. **Exact match:** The fingerprint is looked up in the SSI fingerprint table.
   If found, confidence = 1.0.

3. **Fuzzy match:** If no exact match, `difflib.SequenceMatcher` compares the name
   against all SSI fingerprints in the same region. A match is accepted only if
   **both** conditions hold:
   - Overall ratio >= 0.85 (the `_FUZZY_THRESHOLD`)
   - Per-token minimum > 0.75 (the `_TOKEN_MIN_RATIO`, strictly greater): first
     and last name tokens are compared independently, with digit sequences stripped.
     This prevents false matches where people share only a first or only a last
     name — a common failure mode with Scandinavian surnames that share suffixes
     (-berg, -strom, -ssen).
   - Saved with confidence = actual ratio, method = 'auto_fuzzy'

4. **New identity:** If neither exact nor fuzzy match succeeds, a new canonical_id
   is allocated (>= 2,000,000).

**Phase 3: Manual overrides**

The `rating link-shooter` command creates `method='manual'` links that are never
overwritten by automatic resolution. Used for name changes, aliases, or mismatches
the fuzzy matcher cannot resolve.

### Data quality metrics

The tuning system computes these quality metrics automatically and includes them in
`data/tune_results.json`:

| Metric | What it measures | Why it matters |
|---|---|---|
| fuzzy_link_count | Total auto_fuzzy identity links | Scale of uncertain matching |
| fuzzy_link_low_conf | Links with confidence < 0.90 | Most likely to be wrong |
| identity_coverage | Fraction of test competitors with a canonical_id | Unresolved = invisible to rating |
| avg_competitors_per_match | Mean field size in test matches | Larger fields give richer signals |
| date_range_train | Earliest/latest date in training set | Context for temporal coverage |
| date_range_test | Earliest/latest date in test set | Context for evaluation window |

### Impact of uncertain identity links

A low-confidence fuzzy match can cause two different real-world people to be merged
into one rating profile, or (less commonly) split one person into two profiles. The
effects on ratings depend on several factors:

- **Division rank of the affected person:** If a top-5 rated shooter has a shaky
  identity link, the entire leaderboard is potentially unreliable.
- **Number of matches from the wrong source:** One wrong match from 2018 among 40
  correct SSI matches has negligible impact. Ten wrong matches in the last year
  significantly distort the rating.
- **Recency of the wrong matches:** Algorithms with decay naturally reduce the
  influence of old erroneous data over time.

The static explorer's Identity tab lists all auto_fuzzy links sorted by confidence
ascending, with impact scoring that combines division rank, match exposure fraction,
and recency. High-impact / low-confidence entries should be prioritised for manual
review.

---

## Benchmark methodology

### Evaluation protocol

The benchmark uses a **chronological train/test split** — the most realistic
evaluation for a system that processes matches sequentially over time.

1. All matches are sorted by date.
2. The first `split_ratio` (default: 70%) are used for training.
3. The remaining 30% are used for testing.
4. Cross-source duplicate matches (detected via name similarity >= 0.80 and date
   proximity within 3 days) are excluded from training to avoid data leakage.

**Online evaluation:** During the test phase, each match is evaluated *before* its
results are fed to the algorithm. The algorithm predicts the ranking, the prediction
is scored against the actual result, and then the match data is processed so the
algorithm can learn from it before predicting the next test match. This mirrors
real-world usage: we always predict *forward* in time.

### Ground truth

The "actual ranking" for each test match is computed from `overall_percent` — each
competitor's average overall percentage across all stages they fired. This is
equivalent to their hit-factor percentage relative to the stage winner, averaged
across stages. This metric is cross-divisional: all competitors in the match are
ranked on the same scale regardless of division.

### Metrics

#### Kendall tau rank correlation

    tau = (C - D) / (n * (n-1) / 2)

where C = concordant pairs, D = discordant pairs, and n = number of competitors.
A concordant pair means both the predicted and actual rankings agree on who is better.
A discordant pair means they disagree.

- tau = 1.0: perfect agreement (predicted order matches actual exactly)
- tau = 0.0: no correlation (random ordering)
- tau = -1.0: perfect disagreement (predicted order is reversed)

Kendall tau measures the quality of the *entire* predicted ordering. It weights all
pairs equally — a swap at rank 150 counts the same as a swap at rank 1.

#### Top-K accuracy

    top_k = |predicted_top_k intersect actual_top_k| / k

What fraction of the truly best k competitors appear in the algorithm's predicted
top k? This is the most directly relevant metric for national team selection: if
the actual top 5 all appear in your predicted top 5 (even in different order),
top-5 accuracy = 100%.

#### Mean Reciprocal Rank (MRR)

    MRR = (1/|Q|) * sum over q in Q of (1 / rank_predicted(q))

where Q is the set of actually top-performing competitors (top 10 by actual result).
For each truly elite shooter, find their position in the predicted ranking and take
the reciprocal. Average across all elite shooters.

MRR penalises algorithms that "lose" elite shooters deep in the rankings. If the
actual #1 shooter is predicted at rank 20, that contributes only 1/20 = 0.05.
If predicted at rank 1, it contributes 1.0.

### Per-division Kendall tau

For cross-division fairness analysis, Kendall tau is also computed within each
division separately. This reveals if certain divisions are systematically mis-ranked.

### Interpreting the metrics

For national team selection:

| Priority | Metric | Why |
|---|---|---|
| Highest | Top-5 accuracy | Do we find the right people for the team? |
| High | MRR | Are elite shooters near the top, not buried at rank 20? |
| Medium | Top-10 accuracy | Broader squad selection quality |
| Lower | Kendall tau | Full-field ordering quality (less critical for selection) |

---

## Automated hyperparameter tuning

### Overview

The `rating tune` command runs an automated grid search across all algorithm families
and their tunable parameters. Each configuration is trained on the chronological
training split and evaluated on the test split using the same protocol as the manual
benchmark.

### Grid search space

The search space covers approximately 80 configurations:

| Algorithm | Parameters | Combinations |
|---|---|---|
| ELO | K_default x K_min x K_decay_matches | ~33 (invalid combos excluded) |
| BT+Level | level_scale | 6 |
| PL+Decay | tau | 6 |
| BT+Level+Decay | level_scale x tau | 36 |
| PL (baseline) | — | 1 |
| BT (baseline) | — | 1 |

**ELO grid:** K_default in {24, 32, 40, 48}, K_min in {8, 12, 16}, K_decay_matches in
{15, 20, 30}. Combinations where K_min >= K_default are excluded (invalid).

**BT+Level grid:** level_scale in {0.5, 0.75, 1.0, 1.25, 1.5, 2.0}.

**PL+Decay grid:** tau in {0.04, 0.06, 0.083, 0.10, 0.12, 0.15}.

**BT+Level+Decay grid:** Full cross-product of level_scale x tau (36 combinations).

### Parallelisation

Each configuration is independent — it opens its own read-only database connection,
trains from scratch, and evaluates. Configurations run in parallel via Python's
`ProcessPoolExecutor`:

- Default workers: `min(CPU_count - 1, 8)` — leaves one core free for the OS
- Configurable via `--workers N`
- Each worker opens a read-only DuckDB connection (safe for concurrent reads)
- Progress tracked via Rich progress bar

### Output

Results are saved to `data/tune_results.json` with:

- All configurations ranked by Kendall tau (descending)
- Both base and conservative (+cons) metrics for each configuration
- Data quality metrics for the run
- Timestamp, scoring mode, split ratio, and conservative z-score

A Rich table is printed showing the top 20 results with the best values highlighted
in green and current default parameters marked with *.

### Running the sweep

```bash
# Default: match_pct scoring, 70/30 split, auto worker count
uv run rating tune

# Custom options
uv run rating tune --scoring stage_hf --split 0.8 --workers 4
```

The sweep takes approximately 10-30 minutes depending on CPU count and dataset size.
Designed to run unattended on a server.

---

## Summary table

| Short tag | Algorithm | Model | Level weighting | Recency decay | Best at |
|---|---|---|---|---|---|
| ELO | `elo` | ELO | No | No | Simple baseline |
| PL | `openskill` | Plackett-Luce | No | No | Starting point |
| BT | `openskill_bt` | BradleyTerry | No | No | Top-5/Top-10 accuracy |
| BT+L | `openskill_bt_lvl` | BradleyTerry | Yes | No | Best for current data |
| PL+D | `openskill_pl_decay` | Plackett-Luce | No | Yes | Recency-aware PL |
| BT+LD | `openskill_bt_lvl_decay` | BradleyTerry | Yes | Yes | Most complete model |

**Recommended for national team selection:** `openskill_bt_lvl` base ranking
or `openskill_bt_lvl_decay +cons` (conservative) — the former identifies top
performers most reliably; the latter is the most principled approach for long-term
ranking where recency and experience level should count.

---

## Attribution

The level-scaled beta values and inactivity decay formula used in `openskill_bt_lvl`,
`openskill_pl_decay`, and `openskill_bt_lvl_decay` were adapted from Jonas Emilsson's
[ipsc-ranking project](https://github.com/ipsc-ranking/ipsc-ranking.github.io),
licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Only the algorithmic ideas were borrowed; all code was written independently to fit
this project's architecture and conventions.
