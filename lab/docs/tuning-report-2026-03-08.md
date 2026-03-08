# Hyperparameter Tuning Report — 2026-03-08

Scoring mode: **match_pct** (total match points, one event per match)

## Dataset

| Metric | Value |
|---|---|
| Total matches | 2,039 (3 dedup-skipped) |
| Train split (70%) | 1,425 matches (2004-08-23 to 2023-05-28) |
| Test split (30%) | 611 matches (2023-05-28 to 2026-03-01) |
| Avg competitors/match | 84.9 |
| Fuzzy identity links | 227 total, 40 with confidence < 0.90 |
| Identity coverage | 97.6% of test competitors resolved |
| Configurations evaluated | 86 |

The dataset has grown substantially since the earlier SSI-only benchmarks (which used
~300 matches). With 2,039 matches spanning two decades and international coverage via
ipscresults.org, these results are significantly more representative.

---

## Key finding: Plackett-Luce dominates with match_pct scoring

The most important result is a **reversal of the earlier stage_hf findings**. With
the previous `stage_hf` scoring (one event per stage), BradleyTerry outperformed
Plackett-Luce on all metrics. With `match_pct` scoring (one event per match, using
total match points), **Plackett-Luce wins decisively**.

### Top 10 by Kendall tau (base ranking)

| # | Configuration | tau | Top-5 | Top-10 | MRR |
|---|---|---|---|---|---|
| 1 | **PL+D (tau=0.083)** | **0.4018** | **35.3%** | 46.1% | **0.1785** |
| 2 | PL+D (tau=0.15) | 0.4018 | 35.3% | 46.1% | 0.1785 |
| 3 | PL+D (tau=0.12) | 0.4018 | 35.3% | 46.1% | 0.1785 |
| 4 | PL+D (tau=0.04) | 0.4018 | 35.3% | 46.1% | 0.1785 |
| 5 | PL+D (tau=0.06) | 0.4018 | 35.3% | 46.1% | 0.1785 |
| 6 | PL+D (tau=0.10) | 0.4018 | 35.3% | 46.1% | 0.1785 |
| 7 | **PL (baseline)** | 0.4009 | 35.2% | **46.1%** | 0.1781 |
| 8 | ELO (K=48,min=16,d=30) | 0.3847 | 34.2% | 46.1% | 0.1758 |
| 9 | ELO (K=48,min=12,d=30) | 0.3844 | 34.1% | 46.0% | 0.1753 |
| 10 | ELO (K=40,min=16,d=30) | 0.3839 | 34.3% | 46.1% | 0.1768 |

### Best per algorithm family

| Family | Best config | tau | Top-5 | MRR |
|---|---|---|---|---|
| **PL+Decay** | tau=0.083 (default) | **0.4018** | **35.3%** | **0.1785** |
| **PL (baseline)** | — | 0.4009 | 35.2% | 0.1781 |
| ELO | K=48,min=16,d=30 | 0.3847 | 34.2% | 0.1758 |
| BT+Level+Decay | scale=0.5,tau=0.12 | 0.3742 | 31.1% | 0.1644 |
| BT+Level | scale=1.5 | 0.3652 | 30.9% | 0.1665 |
| BT (baseline) | — | 0.3627 | 30.7% | 0.1646 |

---

## Analysis

### 1. Why Plackett-Luce wins with match_pct

Plackett-Luce models the probability of the full finishing order as a single event.
With `match_pct` scoring, each match is exactly one ranking event — a natural fit.
The model receives one clean signal: the complete match result.

BradleyTerry decomposes rankings into pairwise comparisons. With `stage_hf` (10+
stages per match), BT gets many independent pairwise signals, which plays to its
strength. With `match_pct` (one event per match), BT has far fewer data points and
the pairwise decomposition adds complexity without adding information.

**Verdict:** The scoring mode determines which model family wins. Since `match_pct`
is the natural choice for IPSC (it mirrors official scoring), PL is the better model.

### 2. Decay parameter (tau) has negligible effect

All six PL+Decay configurations produce virtually identical results (tau ranges from
0.4018 to 0.4018, differences in the 5th-6th decimal place). The decay mechanism
adds sigma when a shooter is inactive, but with `match_pct` scoring the PL model's
sigma values are already tightly compressed. Adding a bit more sigma before updating
makes almost no difference.

**Verdict:** Tau is insensitive with match_pct scoring. The default (0.083) is fine.
The decay is not harmful, so keeping it provides insurance against ghost rankings
from retired shooters in long-term use.

### 3. Conservative ranking closes the BT-PL gap

The conservative ranking (mu - z * sigma) behaves very differently across model
families:

| Family | Base tau | Cons tau | Cons boost |
|---|---|---|---|
| PL+Decay | 0.4018 | 0.4025 | +0.0007 |
| PL (baseline) | 0.4009 | 0.4035 | +0.0026 |
| BT (baseline) | 0.3627 | 0.4036 | +0.0410 |
| BT+Level | 0.3652 | 0.4012 | +0.0406 (avg) |
| BT+Level+Decay | 0.3742 | 0.3849 | +0.0101 (avg) |
| ELO | 0.3847 | 0.4308 | +0.0480 (avg)\* |

\* ELO conservative tau is **inflated by a scale mismatch bug** — see note below.

**What's happening:** BT produces wider sigma dispersion than PL. The conservative
ranking heavily penalises high-sigma (uncertain) shooters, which helps BT separate
experienced competitors from one-timers. PL's sigma is already compressed, so the
conservative adjustment barely moves the ranking.

With conservative ranking, BT+cons (0.4036) matches PL base (0.4018) and PL+cons
(0.4035). **The gap disappears entirely.**

BT+Level+Decay gets less cons boost (+0.0101 avg) because the decay mechanism
already narrows sigma differences — the cons ranking has less to work with.

### 4. ELO: strong but cons numbers are unreliable

ELO's base performance (tau=0.3847 for best config) is surprisingly competitive,
beating all BT variants. However, **ELO conservative tau values (0.4308) are
inflated by a bug**: the `_conservative_rank()` function uses OpenSkill-scale defaults
(mu=25, sigma=25/3) for unrated shooters, but ELO ratings are on a 1500-scale.
Unrated shooters get CR = 25 - 0.52*8.33 = 20.6, which is far below any rated ELO
value (~1400-1600). This artificially pushes all unrated shooters to dead last,
inflating tau.

**Verdict:** Ignore ELO cons metrics. Base ELO is solid (#3 family), but lacks
uncertainty tracking, which limits its usefulness for team selection.

### 5. Level scaling barely helps

BT+Level (scale=1.5) gets tau=0.3652 vs BT baseline 0.3627 — a +0.0025 improvement.
The optimal scale (1.5) is slightly above the default (1.0), suggesting the original
beta values could be more aggressive. But the effect is tiny and likely within noise.

**Verdict:** Level scaling is a theoretical improvement but empirically marginal with
this dataset. Keep it for principled reasons (L2 vs L5 really should differ) but don't
expect measurable gains.

---

## Recommendations

### Primary algorithm: PL+Decay (default parameters)

For the main ranking on the scoreboard, **PL+Decay with tau=0.083** (the current
default) is the best choice. It wins on every metric with base ranking.

The decay adds near-zero overhead and provides long-term protection against ghost
rankings. There is no reason to change the default tau — the parameter is insensitive.

### Keep BT+Level+Decay for comparison

BT+LD provides a meaningfully different signal (pairwise model with level weighting
and decay). While it underperforms PL on base ranking, its conservative ranking is
useful as a complementary view. Showing both algorithms lets users see if the ranking
changes depending on the model — large differences flag competitors whose position is
model-dependent and therefore uncertain.

### Fix the conservative ranking scale bug for ELO

The `_conservative_rank()` function in both `sweep.py` and `runner.py` uses hardcoded
OpenSkill-scale defaults (mu=25, sigma=25/3). This produces nonsensical conservative
rankings for ELO (which uses a 1500 scale with sigma=0). Either:

1. Make `_conservative_rank()` algorithm-aware (pass default_mu/default_sigma), or
2. Since ELO sigma=0, skip conservative ranking entirely for ELO (cons = base).

### Algorithm defaults: no changes needed

The current defaults are confirmed as optimal or near-optimal:

| Algorithm | Current default | Best found | Change needed? |
|---|---|---|---|
| PL+Decay tau | 0.083 | 0.083 | No |
| BT+Level scale | 1.0 | 1.5 | Optional (+0.0025 tau) |
| BT+LD scale | 1.0 | 0.5 | Optional (+0.003 tau) |
| BT+LD tau | 0.083 | 0.12 | Optional (negligible) |
| ELO K/min/decay | 32/16/20 | 48/16/30 | Optional (+0.003 tau) |

None of these potential changes are large enough to justify the risk of disrupting
existing ratings. The differences are within noise margins.

---

## Data quality assessment

- **97.6% identity coverage** — excellent. Only 2.4% of test competitors are unresolved
  (likely ipscresults-only shooters with no SSI match history).
- **227 fuzzy links, 40 low-confidence** — manageable. The 40 low-confidence links
  (<0.90) should be reviewed via the Identity tab but are unlikely to affect top
  rankings (as shown in the earlier impact analysis).
- **84.9 avg competitors/match** — large fields provide rich ranking signals per event.
- **2004-2026 date range** — 22 years of history, with the test period (2023-2026)
  covering recent active competition. The training set is dominated by older
  ipscresults data; the test set is mostly recent SSI data.

---

## Comparison with previous stage_hf results

The earlier benchmark (SSI-only, ~300 matches, stage_hf scoring) found:

- BT > PL on all metrics (especially Top-5: 59% vs 38%)
- BT+Level best MRR
- BT+Level+Decay best overall tau

With the current dataset (2,039 matches, match_pct scoring):

- PL > BT on all metrics (tau: 0.4018 vs 0.3627)
- All absolute metric values are lower (tau ~0.40 vs ~0.56 previously)

The lower absolute values are expected: the dataset is much larger and more diverse
(international competitors, wider skill range, more noise from cross-source identity
linking). The model reversal (PL now wins) is entirely explained by the scoring mode
change — match_pct naturally favours Plackett-Luce's full-ranking model.
