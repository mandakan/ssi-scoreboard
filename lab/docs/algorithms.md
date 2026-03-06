# Rating Algorithms — Plain-Language Guide

This document explains every rating algorithm in the lab: what it does, why it was included,
what it's good at, and where it falls short. Written for humans, not mathematicians.

---

## The core idea: what is a skill rating?

A rating system tries to answer one question: *given what we've seen before, how good is
this person?*

Every algorithm in this lab boils down to two numbers per shooter:

- **μ (mu)** — the best guess of their skill level. Higher = better.
- **σ (sigma)** — how confident we are in that guess. Lower = more certain.

When a shooter first appears in the system they start at default values (μ = 25, σ ≈ 8.3).
Every match they compete in moves their μ up or down and (usually) reduces their σ,
because we now have more evidence. After enough matches their rating stabilises.

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

## The algorithms

### ELO (`elo`) — the classic baseline

**What it is:** The same system used in chess and FIFA football rankings. Each stage result
is broken into a series of head-to-head comparisons: A vs B, A vs C, B vs C, and so on.
If you beat someone you were "expected" to beat, your rating barely moves. If you beat
someone rated much higher, your rating jumps.

**Parameters:**
- Starting rating: 1500 (arbitrary scale)
- K-factor: 32 for new shooters, decaying to 16 after 20 matches. K controls how much
  each result can move your rating. High K = faster to react, but also more volatile.

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

**What it is:** A modern Bayesian skill rating system. Instead of pairwise comparisons like
ELO, it models the *probability of a full finishing order*. "Given everyone's ratings, how
likely is it that A finished first, B second, C third...?" The ratings are then updated
to make observed results more probable in hindsight.

"Bayesian" means the system maintains genuine uncertainty (σ) and updates it mathematically
as evidence accumulates. σ naturally shrinks with more matches and grows if the system
is surprised by an outcome.

The "Plackett-Luce" part is the statistical model used. Think of it as asking: what is the
probability of the observed ranking given everyone's skill? The system adjusts ratings
to maximise that probability.

**Parameters:** Uses OpenSkill library defaults (μ=25, σ≈8.3, beta≈4.2). No special
configuration — this is the plain off-the-shelf model.

**Strengths:**
- Mathematically well-founded — uncertainty is real and meaningful
- σ shrinks naturally with experience, giving more reliable estimates for veteran shooters
- Captures the full ranking at once rather than simulating pairwise comparisons

**Weaknesses:**
- All matches treated equally (a club regional has the same weight as the World Shoot)
- No concept of time or recency — a shooter who last competed 3 years ago has the same
  σ as one who competed last weekend
- **Notably worse at identifying top performers** than the BT model in our tests (38% vs 59%
  top-5 accuracy) — possibly because Plackett-Luce's "full ranking" model is more sensitive
  to noise from the large mixed-division fields in our data

**Why include it?** It's the starting point we built everything else on.

---

### OpenSkill BradleyTerry Partial (`openskill_bt`) — the pairwise Bayesian model

**What it is:** The same Bayesian framework as Plackett-Luce, but uses a different underlying
model called Bradley-Terry. Instead of modelling the full finishing order at once, it
models a series of pairwise match-ups. For a stage with 100 competitors, BT internally
considers roughly 4,950 pairings (every possible pair) and updates based on who won each
one.

"Partial" means it uses an approximation that is faster to compute while keeping most of the
accuracy.

**Parameters:** Same OpenSkill defaults as above, no special configuration.

**Strengths:**
- Same uncertainty (σ) benefits as Plackett-Luce
- **Significantly better at identifying top performers** in our tests: 59% top-5 accuracy
  vs 38% for the PL model — the pairwise approach seems better suited to the large,
  noisy, mixed-division IPSC fields
- Better MRR (0.2452 vs 0.2045) — the actual top shooters appear higher in the predicted list

**Weaknesses:**
- Still treats all matches equally
- Still no recency / inactivity handling
- Like all Bayesian models, it needs enough match history before ratings stabilise

**Why include it?** The benchmark result surprised us: BT substantially outperforms PL at
the top end. For national team selection (where you care most about correctly identifying
the very best), BT is clearly the better base model.

---

### BradleyTerry with Level-Scaled Beta (`openskill_bt_lvl`)

**What it is:** Identical to `openskill_bt` but with one extra rule: the *weight* of each
match result depends on the match level.

**What is beta?** Beta controls how "noisy" a single match result is assumed to be. A small
beta says: "outcomes are very predictable — skill differences show up clearly in results."
A large beta says: "anything can happen in one match — even a weak shooter can beat a
strong one by luck." Higher beta = each match result changes ratings less. Lower beta
= each match changes ratings more.

We use different betas per level:

| Level | Beta | What this means |
|---|---|---|
| L2 (regional) | 2.1 | Results are treated as fairly reliable skill signals |
| L3 (national) | 4.2 | Near-default; moderate result influence |
| L4 (continental) | 8.3 | Higher uncertainty assumed per result; ratings update less per match |
| L5 (world) | 16.7 | Large field, many competitors, high variance assumed |

*These values are adapted from Jonas Emilsson's ipsc-ranking project — see attribution below.*

**Intuition:** At a World Shoot, 700+ competitors from everywhere compete. The sheer size
and mix means a single result is quite "noisy" — great shooters can have off days, unknown
quantities can surprise everyone. At a smaller regional with familiar competitors, results
are more predictable.

Note: these values are a starting hypothesis, not proven fact. The benchmark will tell
us whether they actually help.

**Strengths:**
- Treats higher-level results more carefully (less volatile updates from one big result)
- Slightly better MRR than plain BT (0.2501 vs 0.2452) — top performers identified
  more reliably
- Logically appealing for national team selection: a World Shoot result *should* be weighted

**Weaknesses:**
- Our dataset currently has mostly L2/L3 matches (only those two levels appear in the
  stored data), so L4/L5 scaling is untested
- The specific beta values are educated guesses — they may need tuning
- Same lack of recency handling as plain BT

---

### Plackett-Luce with Inactivity Decay (`openskill_pl_decay`)

**What it is:** Same as the base `openskill` model, but when a shooter reappears after a
long gap, their σ is deliberately increased before their rating is updated.

**How the decay works:** We track when each shooter last competed. When they appear in a
new match, we calculate how many days have passed and add a small amount to their σ
proportional to that gap:

> extra_σ = 0.083 × days_since_last_match (capped at the default maximum σ)

A shooter absent for 30 days gains about 2.5 extra σ. A shooter absent for 100+ days
drifts back to the default starting σ (as if we barely know them anymore). After they
compete again, σ will start falling as usual.

*The decay formula is adapted from Jonas Emilsson's ipsc-ranking project — see attribution below.*

**Why this matters for national team selection:** If someone dominated 3 years ago but
hasn't competed since, should they be near the top of a national ranking? Probably not.
Their σ should have grown, and when they return, a few good results will bring it back
down quickly. Without decay, old results lock in a high μ indefinitely.

**Strengths:**
- Recency matters — active shooters get more reliable ratings
- Protects against "ghost rankings" where retired shooters block active ones

**Weaknesses:**
- In our benchmark tests, this model performs nearly identically to plain `openskill` —
  because our test dataset is mostly compact (all within the same 1-2 year window), so
  inactivity gaps aren't large enough to have much effect
- Decay hurts a little in Top-5 accuracy if elite shooters tend to compete less often
  between major matches — they accumulate σ between events

---

### BradleyTerry with Level Scaling + Decay (`openskill_bt_lvl_decay`)

**What it is:** The "kitchen sink" model — combines BT model + level-scaled beta +
inactivity decay. All three ideas at once.

**Strengths:**
- Best overall Kendall τ among all OpenSkill variants (0.5601) — most accurate at
  predicting the full field ordering
- Good balance across all metrics
- Most principled for long-term national ranking: level weighting + recency + BT accuracy

**Weaknesses:**
- More complex than simpler models — harder to debug if something behaves unexpectedly
- Still gets slightly lower Top-5 accuracy than plain BT (56.4% vs 59.1%) — the decay
  appears to slightly hurt identification of the very top shooters (see discussion below)

**Why does decay hurt Top-5 accuracy?** A hypothesis: elite shooters compete at fewer
matches (they focus on major events). Between a big match and the next one, their σ grows
due to inactivity. When the benchmark tries to predict the next match, some of these elites
have a temporarily higher σ, and the conservative/mu ranking pushes them down slightly.
The decay is "working as intended" from a fairness standpoint but is a real limitation in
the benchmark's test window.

---

## Conservative ranking (`+cons`)

Every algorithm above produces two ranking signals:

1. **Base ranking** — sorted by μ alone. Simple and fast.
2. **Conservative ranking (+cons)** — sorted by μ − 0.52×σ. This is the "70th percentile"
   estimate: we're 70% confident the shooter's true skill is *at least this high.*

**Why conservative ranking matters for national team selection:** Imagine two shooters:

- Alice: μ=28, σ=4 (many matches, consistent) → conservative score ≈ 25.9
- Bob: μ=30, σ=9 (few matches, inconsistent) → conservative score ≈ 25.3

Base ranking puts Bob first. Conservative ranking puts Alice first. For national team
selection, Alice is the safer pick — she has demonstrated sustained excellence. Bob might
be great but might also have had two lucky matches. The conservative approach rewards
consistency and penalises uncertainty.

The z-score 0.52 corresponds to the 70th percentile of a normal distribution. It was chosen
to be meaningful but not too harsh — shooters with moderate experience are not excessively
penalised.

---

## Cross-division fairness

The per-division breakdown in the benchmark reports Kendall τ *within each division*.
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

The per-division τ table shows if any algorithm is systematically biased — if one division
consistently gets lower τ than others, that division is being mis-ranked and the algorithm
is less trustworthy for team selection from that division.

---

## How to read the benchmark metrics

| Metric | What it measures | Why it matters |
|---|---|---|
| **Kendall τ** | Overall rank correlation between predicted and actual (0 = random, 1 = perfect) | General quality of the full predicted ordering |
| **Top-5 accuracy** | What fraction of the actual top 5 appear in the predicted top 5 | Critical for team selection — do we find the right people? |
| **Top-10 accuracy** | Same but for top 10 | Useful for squad selection and ranking breadth |
| **MRR** | "On average, how highly do we rank the actual top performers?" | Ensures truly elite shooters appear near the top, not buried in 20th place |

For national team selection, **Top-5/Top-10 accuracy and MRR matter most.** Kendall τ
measures how well the algorithm ranks the entire field of 150+ shooters, which includes
many head-to-head comparisons that don't affect team selection at all.

---

## Summary table

| Algorithm | Model | Level weighting | Recency decay | Best at |
|---|---|---|---|---|
| `elo` | ELO | No | No | Simple baseline; surprisingly good Kendall τ |
| `openskill` | Plackett-Luce | No | No | Starting point; worst at top-end accuracy |
| `openskill_bt` | BradleyTerry | No | No | Top-5/Top-10 accuracy; best base model |
| `openskill_bt_lvl` | BradleyTerry | Yes | No | Best MRR; good choice for current data |
| `openskill_pl_decay` | Plackett-Luce | No | Yes | Shows recency doesn't hurt PL |
| `openskill_bt_lvl_decay` | BradleyTerry | Yes | Yes | Best Kendall τ; most complete model |

**Recommended starting point for national team selection:** `openskill_bt_lvl` base ranking
or `openskill_bt_lvl_decay +cons` (conservative) — the former identifies top performers
most reliably in the current data; the latter is the most principled approach for long-term
ranking where recency and experience level should count.

---

## Attribution

The level-scaled beta values and inactivity decay formula used in `openskill_bt_lvl`,
`openskill_pl_decay`, and `openskill_bt_lvl_decay` were adapted from Jonas Emilsson's
[ipsc-ranking project](https://github.com/ipsc-ranking/ipsc-ranking.github.io),
licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Only the algorithmic ideas were borrowed; all code was written independently to fit this
project's architecture and conventions.
