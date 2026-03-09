# Rating Algorithms — Technical Reference

This document describes every rating algorithm in the SSI scoreboard lab:
plain-language explanations for practitioners, mathematical formulations for
researchers, data quality considerations, and the automated tuning methodology.

---

## Table of Contents

1. [The core idea: what is a skill rating?](#the-core-idea-what-is-a-skill-rating)
2. [How performance is measured in IPSC](#how-performance-is-measured-in-ipsc)
3. [Scoring modes](#scoring-modes)
   - [Stage HF](#stage-hf-stage_hf)
   - [Match Percentage](#match-percentage-match_pct)
   - [Combined Match Percentage](#combined-match-percentage-match_pct_combined)
4. [The algorithms](#the-algorithms)
   - [ELO — the classic baseline](#elo-elo--the-classic-baseline)
   - [OpenSkill Plackett-Luce](#openskill-plackett-luce-openskill--the-full-ranking-model)
   - [OpenSkill BradleyTerry Partial](#openskill-bradleyterry-partial-openskill_bt--the-pairwise-bayesian-model)
   - [BradleyTerry with Level-Scaled Beta](#bradleyterry-with-level-scaled-beta-openskill_bt_lvl)
   - [Plackett-Luce with Inactivity Decay](#plackett-luce-with-inactivity-decay-openskill_pl_decay)
   - [BradleyTerry with Level Scaling + Decay](#bradleyterry-with-level-scaling--decay-openskill_bt_lvl_decay)
   - [ICS 2.0 — Swedish federation team selection benchmark](#ics-20-ics--swedish-federation-team-selection-benchmark)
5. [Conservative ranking](#conservative-ranking-cons)
6. [Percentile score (0–100)](#percentile-score-0100)
7. [Cross-division fairness](#cross-division-fairness)
8. [Data quality and identity resolution](#data-quality-and-identity-resolution)
9. [Benchmark methodology](#benchmark-methodology)
10. [Automated hyperparameter tuning](#automated-hyperparameter-tuning)
11. [Summary table](#summary-table)
12. [Attribution](#attribution)

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

### Combined Match Percentage (match_pct_combined)

> **Plain language:** "We want to compare Open, Production, and Standard shooters
> against each other — not just within their own division."
>
> The problem: an Open shooter scoring 85% at a match sounds similar to a Production
> shooter scoring 85%, but they are not directly comparable because the two divisions
> use different equipment and produce systematically different score levels.
>
> The solution: measure what "85%" means *relative to that division's typical level*,
> then place everyone on one shared scale. This is the same approach used by the Swedish
> federation's ICS 2.0 national team selection system.

The entire match is one ranking event, like `match_pct`, but all divisions compete
**on a single combined scale** instead of being rated independently. Each competitor's
metric is their average `overall_percent` (percentage of the stage winner's hit factor
across all competitors), normalised by a **division weight factor**.

Division weights are computed from a set of anchor matches (high-level events) and
represent the Nth percentile of performance within each division:

    weight(division) = Nth percentile of avg_overall_percent for division competitors
                       measured across anchor events

    normalised_score = competitor_avg_overall_percent / weight(division) × 100

A normalised score of 100 means the competitor performed at the anchor percentile for
their division. This collapses Open, Production, Standard, etc. onto a single axis —
enabling cross-division comparisons and career ratings that don't require division choice.

**Anchor hyperparameters (tunable):**

| Parameter | Values | Description |
|---|---|---|
| `anchor_percentile` | 50, 60, 67, 75, 80 | Percentile used as the division weight. 67 mirrors the Swedish ICS 2.0 system. |
| `anchor_source` | `l4plus`, `l3plus` | Which matches to use as anchors. `l4plus` = World/Continental (L4–L5); `l3plus` = National+ (L3–L5). |

**Advantages:** Enables cross-division career ratings; directly answers "who is the
best shooter overall regardless of division?"; comparable to the Swedish ICS 2.0 national
team selection methodology.

**Disadvantages:** Ratings depend on the anchor event quality and percentile choice.
Divisions with few anchor-event competitors get less reliable weights. A new algorithm
entry — ratings are stored with a `_combined` suffix so they coexist with per-division
modes.

**Design note:** When a competitor's division is missing from the anchor data, a neutral
weight of 100.0 is used (no normalisation). All competitors rank in a single group with
`division=None` key in the ratings store.

### Which to use?

For **national team selection** (the primary use case), `match_pct` is recommended
as the default because it aligns with how matches are officially scored and how
selectors think about performance. A shooter's overall match result — not individual
stage hit factors — determines standings in real competitions.

Use `match_pct_combined` when you need **cross-division comparison** — for example,
when the selection committee wants to rank the top N Swedish shooters across all
divisions rather than selecting separately per division. Benchmark results for this
mode are under active development; see the tuning report for the latest findings.

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

### ICS 2.0 (`ics`) — Swedish federation team selection benchmark

**Reference:** https://ics2.pages.dev/

**What it is:** The method used by the Swedish IPSC federation for 2026 national
team selection. It is included here as a **benchmark baseline** — not because we
necessarily think it is the best approach, but because having hard numbers enables
a genuine conversation: "here is where ICS is stronger; here is where our Bayesian
approaches are stronger."

ICS 2.0 is **fundamentally different** from all the other algorithms in this lab.
It is *not* a skill model that learns over time. It does not update a shooter's
belief incrementally after every match. Instead, it is a **batch peer-comparison
system**: for each match, it asks: *"How would this shooter have performed at the
World Shoot, based on how they did here relative to World Shoot participants who
also competed in this match?"*

#### Plain-language walkthrough

**Step 1 — Anchor event.**
The most recent L4 or L5 match (World/Continental Championship) is the *anchor*.
Every competitor at that event gets a **reference score** representing their
normalised performance. This reference score is the fixed "gold standard" against
which all future results are measured.

**Step 2 — Division weighting.**
Different IPSC divisions produce different score levels by design — an Open shooter
hitting 85% is not the same as a Production shooter hitting 85%, because Open allows
optical sights, compensators, and higher-capacity magazines. To compare them fairly,
ICS first establishes each division's *typical level* at the anchor event:

> The division weight is the **67th percentile** of all competitors' scores in that
> division at the anchor. If Production shooters typically score around 78% at the
> World Shoot, then 78% is the Production benchmark.

A competitor's **combined score** (comb) at any match is then:

    comb = their avg_overall_percent / division_weight × 100

A Production shooter who scores exactly at the 67th-percentile level gets comb = 100.
A stronger shooter gets comb > 100. This normalisation collapses Open, Production,
Standard etc. onto a single shared scale.

**Step 3 — Peer comparison at each match.**
At a regular ranking match, some of the competitors were also at the anchor event
(they have a known reference score). For each such "reference competitor" B:

    contrib(A, B) = (A's comb at this match / B's comb at this match) × B's comb at anchor

Plain language: if A outperformed B by 10% at this match, and B scored 88% at the
World Shoot, then A would have scored approximately 88% × 1.10 = 96.8% at the World
Shoot. Each reference competitor B provides one such estimate. They are averaged to
produce A's **match weighted score**.

**Step 4 — Final ranking.**
A shooter's final ICS score is the **average of their best `top_n` match weighted
scores** (default: 3). The idea is similar to track and field rankings — your best
three results count, not your average over everything.

#### Worked example

Suppose the World Shoot anchor establishes these division weights:

- Production: 67th percentile = 78%
- Open: 67th percentile = 82%

Two World Shoot participants who will appear as references:

- David (Production): scored 88% at the World Shoot → comb_anchor = 88/78 × 100 = 112.8
- Erik (Open): scored 84% at the World Shoot → comb_anchor = 84/82 × 100 = 102.4

Now Anton (Production) competes at a regional match alongside David and Erik:

| Shooter | Division | % at regional | comb at regional |
|---|---|---|---|
| Anton | Production | 90% | 90/78 × 100 = 115.4 |
| David | Production | 85% | 85/78 × 100 = 109.0 |
| Erik | Open | 80% | 80/82 × 100 = 97.6 |

**contrib(Anton, David)** = (115.4 / 109.0) × 112.8 = **119.5**
> Anton outperformed David by 5.9% at this match. Scaled to David's World Shoot
> level (112.8), that puts Anton at ≈ 119.5.

**contrib(Anton, Erik)** = (115.4 / 97.6) × 102.4 = **121.1**
> Anton outperformed Erik by 18.2% at this match. Scaled to Erik's World Shoot
> level (102.4), that puts Anton at ≈ 121.1.

**Anton's match score** = (119.5 + 121.1) / 2 = **120.3**

After several matches, Anton's final ICS score is the average of his three best
match scores. A score around 100 means "World-Shoot-level performance in this
division." A score above 100 means better than the 67th percentile at the World Shoot.

#### Mathematical formulation

**Division weight:**

    weight(D) = pth percentile of {avg_overall_percent of all competitors
                                   in division D at the anchor event}

Default p = 67 (tunable: 50, 60, 67, 75, 80).

**Normalised combined score:**

    comb(competitor, match) = avg_overall_percent / weight(division) × 100

**Peer contribution:**

    contrib(A, B) = comb(A, current_match) / comb(B, current_match) × comb(B, anchor)

This can be rewritten as:

    contrib(A, B) = (A's performance relative to B at this match) × B's known World-Shoot level

**Match weighted score:**

    weighted(A, match) = mean of contrib(A, B) for all reference competitors B
                         present in this match who have an anchor score

**Final ICS score:**

    ICS(A) = mean of top top_n values in {weighted(A, match) for all matches A has played}

**Special case — anchor event itself:**
At the anchor event, every competitor is also a reference competitor. Since each
competitor's current-match comb equals their anchor comb, the contribution formula
simplifies:

    contrib(A, B) = comb(A, anchor) / comb(B, anchor) × comb(B, anchor) = comb(A, anchor)

So at the anchor event every competitor's match score equals their own normalised score.
This is mathematically consistent and exactly what ICS intends.

**Fallback — no reference competitors:**
If no anchor event has been processed yet, or if no reference competitors happen to
appear in a particular match, the normalised comb score is used directly as the match
score. This ensures the algorithm degrades gracefully on early historical data.

#### How this benchmark adaptation differs from real ICS 2.0

The official ICS 2.0 uses a single fixed anchor: World Shoot 2025. In this benchmark:

- **Rolling anchor:** whenever an L4 or L5 match is processed chronologically, it
  becomes the new anchor and replaces the previous one. This is necessary because the
  dataset spans 2004–2026 with multiple World Shoots.
- **No manual override list:** the official system uses a hand-curated list of 11
  ranking matches for 2026 selection. Here, all L2+ matches feed the algorithm.
- **Continuous vs batch:** the official system is recalculated in a single batch at
  the end of the selection period. Here, matches are processed one-by-one in
  chronological order (required by the benchmark framework).

These adaptations are necessary for a fair apples-to-apples benchmark but mean the
benchmark ICS results are an approximation of the official method, not an exact replica.

#### Tunable parameters

| Parameter | Default | Values tested | What it controls |
|---|---|---|---|
| `anchor_percentile` | 67 | 50, 60, 67, 75, 80 | Which percentile to use as the division weight. 67 mirrors the official ICS 2.0 specification. A higher percentile raises the bar, making scores lower overall. |
| `top_n` | 3 | 2, 3, 4, 5 | How many best results count. Official ICS 2.0 uses 3. More results averages out single-match luck but dilutes peak performance. |

The sweep tests all 20 combinations (5 × 4) with `match_pct` scoring.

#### Strengths

- **Transparent and interpretable:** every number in the ranking can be traced
  directly to specific match results. There is no statistical black box.
- **Cross-division by design:** the division weighting explicitly handles Open vs
  Production vs Standard — no approximations needed.
- **Familiar to the federation:** since this is the actual selection method, results
  can be directly discussed with federation officials.
- **Rewards peak performance:** the top-N structure means one exceptional match at a
  major event can carry a shooter, which many selectors feel is appropriate.

#### Weaknesses

- **Not a skill model:** it produces no uncertainty estimate (sigma). Conservative
  ranking cannot differentiate between a shooter with 1 result and one with 20.
- **Anchor dependency:** all scores depend on the quality and composition of the
  anchor event. A rolling anchor that changes mid-season can cause discontinuities.
- **Sparse reference links:** at any given match, most competitors are *not* World
  Shoot participants. If only 2 out of 80 competitors have anchor scores, those 2
  people's results dominate A's match score. Results from low-reference-density
  matches may be unreliable.
- **No recency:** a result from 5 years ago counts the same as one from last month,
  as long as it is in the top N. The Bayesian models with decay handle this better.
- **Not online:** designed as a batch calculation over a fixed season, not as a
  running ranking. Adapting it to the chronological benchmark framework requires
  approximations (see above).

**Why does ICS matter for this project?**
The Swedish IPSC community deserves a data-driven comparison between ICS and the
Bayesian approaches — not just opinions. Benchmark numbers showing "ICS has 0.45 Kendall
tau while BT+LD has 0.52, but ICS has better top-5 accuracy for the Open division"
enable a constructive, specific conversation rather than a philosophical debate.

---

## Conservative ranking (+cons)

Every algorithm above produces two ranking signals:

1. **Base ranking** — sorted by mu alone. Simple and fast.
2. **Conservative ranking (+cons)** — sorted by mu - z * sigma. This is the "70th
   percentile" estimate: we're 70% confident the shooter's true skill is *at least
   this high.*

---

## Percentile score (0–100)

### Plain-language summary

> **"What percentage of rated competitors in my division am I better than?"**

The percentile score converts the raw rating numbers (which require statistical knowledge
to interpret) into a single easy-to-read number between 0 and 100.

| Percentile | What it means |
|---|---|
| **100** | Best rated competitor in the division |
| **90** | Better than 90% of all rated competitors — top 10% |
| **50** | Right in the middle of the pack |
| **0** | Lowest rated competitor in the division |

For example, a Production shooter with a percentile of **87.4** is better than 87.4%
of all rated Production competitors. No statistics required to understand this — higher
is always better.

### How it is calculated

The percentile is computed as a **post-processing presentation layer** after all mu/sigma
values have been calculated. It does not change the underlying ratings in any way.

Steps:

1. For each *(algorithm, division)* combination, collect all shooters with a rating.
2. Sort them by their conservative rating (CR = mu − z·sigma) from lowest to highest.
3. Assign each shooter a position: 0% = worst CR in the group, 100% = best CR.
4. Ties (same CR value) are handled by averaging their shared positions.

Mathematical formula for a shooter at rank *r* (1 = best) in a group of *N* shooters:

    pct = (N - r) / (N - 1) × 100         (when N > 1)
    pct = 100                               (when N = 1)

Equivalently, counting how many shooters are below:

    pct = (shooters_with_lower_CR + half_of_tied_shooters) / (N - 1) × 100

### Why within-division only?

Percentile is always computed **within the same division** — an Open shooter is compared
only to other Open shooters. This is by design: different divisions use different
equipment and have different characteristic score ranges, making raw point totals
incomparable across divisions. Ranking Open vs Production by raw numbers would systematically
favour one division over the other depending on match composition.

For cross-division comparison, use the *match_pct_combined* scoring mode instead, which
explicitly normalises results across divisions using an anchor-event reference.

### Why based on conservative rating (CR), not raw mu?

The percentile is derived from CR (mu − z·sigma) rather than raw mu because CR already
accounts for experience:

- A shooter with 2 matches has high sigma → lower CR → lower percentile
- A shooter with 50 matches has low sigma → CR close to mu → percentile reflects sustained performance

This prevents new shooters from dominating the rankings after one excellent match.

### Reference population

The current implementation uses **all rated shooters in the division** as the reference
population, regardless of activity level. Applying the "minimum matches" filter in the
explorer restricts the *displayed* list but does not change the percentile score — it is
always computed against the full rated population.

---

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

The search space covers approximately 100 configurations for `match_pct` scoring:

| Algorithm | Parameters | Combinations |
|---|---|---|
| ELO | K_default x K_min x K_decay_matches | ~33 (invalid combos excluded) |
| BT+Level | level_scale | 6 |
| PL+Decay | tau | 6 |
| BT+Level+Decay | level_scale x tau | 36 |
| PL (baseline) | — | 1 |
| BT (baseline) | — | 1 |
| ICS 2.0 | anchor_percentile x top_n | 20 |

**ELO grid:** K_default in {24, 32, 40, 48}, K_min in {8, 12, 16}, K_decay_matches in
{15, 20, 30}. Combinations where K_min >= K_default are excluded (invalid).

**BT+Level grid:** level_scale in {0.5, 0.75, 1.0, 1.25, 1.5, 2.0}.

**PL+Decay grid:** tau in {0.04, 0.06, 0.083, 0.10, 0.12, 0.15}.

**BT+Level+Decay grid:** Full cross-product of level_scale x tau (36 combinations).

**ICS 2.0 grid:** anchor_percentile in {50, 60, 67, 75, 80} x top_n in {2, 3, 4, 5}.
ICS is only evaluated with `match_pct` scoring — it handles division weighting
internally, so running it with `match_pct_combined` (which pre-normalises scores)
would double-normalise and produce incorrect results.

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

| Short tag | Algorithm | Model type | Level weighting | Recency decay | Uncertainty (sigma) | Best at |
|---|---|---|---|---|---|---|
| ELO | `elo` | Pairwise ELO | No | No | No | Simple baseline |
| PL | `openskill` | Bayesian Plackett-Luce | No | No | Yes | Starting point |
| BT | `openskill_bt` | Bayesian BradleyTerry | No | No | Yes | Top-5/Top-10 accuracy |
| BT+L | `openskill_bt_lvl` | Bayesian BradleyTerry | Yes | No | Yes | Best for current data |
| PL+D | `openskill_pl_decay` | Bayesian Plackett-Luce | No | Yes | Yes | Recency-aware PL |
| BT+LD | `openskill_bt_lvl_decay` | Bayesian BradleyTerry | Yes | Yes | Yes | Most complete Bayesian model |
| ICS | `ics` | Peer comparison | No (div-weighted) | No | No | Federation benchmark |

**Recommended for national team selection:** `openskill_bt_lvl` base ranking
or `openskill_bt_lvl_decay +cons` (conservative) — the former identifies top
performers most reliably; the latter is the most principled approach for long-term
ranking where recency and experience level should count.

**ICS 2.0** is included as the federation baseline. See benchmark results for a
direct numerical comparison of where ICS and the Bayesian approaches differ.

---

## Attribution

The level-scaled beta values and inactivity decay formula used in `openskill_bt_lvl`,
`openskill_pl_decay`, and `openskill_bt_lvl_decay` were adapted from Jonas Emilsson's
[ipsc-ranking project](https://github.com/ipsc-ranking/ipsc-ranking.github.io),
licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Only the algorithmic ideas were borrowed; all code was written independently to fit
this project's architecture and conventions.

The ICS 2.0 algorithm (`ics`) is the Swedish IPSC federation's national team selection
method. The specification and formula were reconstructed from the publicly available
description at [ics2.pages.dev](https://ics2.pages.dev/). The implementation here is
an independent reconstruction for benchmarking purposes; it is not the official ICS
software. Any discrepancies between this implementation and the official results should
be reported so they can be corrected.
