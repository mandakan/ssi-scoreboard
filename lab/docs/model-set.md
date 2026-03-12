# Canonical Model Set

Defines the **11-model reference set** used for training, benchmarking, and
hyperparameter sweeps. Every model has a specific comparative purpose; models
that don't differentiate themselves or are strictly dominated have been pruned.

This set replaces the earlier `--algorithm all` approach, which generated
~20 models with significant overlap and no explicit rationale for most of them.

---

## The models

### Group A — All-data baselines (match_pct)

These three form the core comparison set. Any meaningful finding about a new
algorithm or data variant should be measured against all three.

| Stored name | Command |
|---|---|
| `openskill_pl_decay_mpct` | `--algorithm openskill_pl_decay --scoring match_pct` |
| `openskill_bt_lvl_decay_mpct` | `--algorithm openskill_bt_lvl_decay --scoring match_pct` |
| `ics_mpct` | `--algorithm ics --scoring match_pct` |

**`openskill_pl_decay_mpct` — primary algorithm.**
PL+Decay is the best-performing model across all benchmarks on the 2,039-match
international dataset (Kendall τ = 0.4018). It wins because `match_pct` scoring
gives the model exactly what it needs: one clean full-ranking event per match,
which the Plackett-Luce distribution models natively. The decay term (τ = 0.083)
prevents ghost rankings for retired shooters and is essentially free — all tau
values between 0.04 and 0.15 produce the same metrics, so the default is confirmed
optimal.

**`openskill_bt_lvl_decay_mpct` — level-weighted comparison.**
BT+Level+Decay performs below PL (τ = 0.3742) but produces a meaningfully
different signal: it uses pairwise comparisons weighted by match level, giving
World Shoot results 8× more rating influence than a Regional match. The conservative
ranking (μ − 0.52σ) partially closes this gap because BT maintains wider sigma
dispersion. Keeping this model lets the explorer show when a ranking is
model-dependent — if a shooter ranks very differently between PL and BT+LvL, their
position is genuinely uncertain and worth flagging for team selection.

**`ics_mpct` — ICS 2.0 benchmark.**
The Swedish federation's official team selection algorithm is not a skill model
at all — it's a peer-comparison system that asks "how would this shooter have
performed at the World Shoot?" It serves as a non-parametric reference point.
Including it in every comparison run ensures any improvements to the Bayesian
algorithms are improvements relative to the official method, not just relative
to each other.

---

### Group B — Algorithm baselines (match_pct)

Single representatives from older model families. Kept to anchor two specific
questions: "what does decay actually add?" and "how does a classical algorithm
compare?". Not needed for day-to-day team selection.

| Stored name | Command |
|---|---|
| `openskill_mpct` | `--algorithm openskill --scoring match_pct` |
| `elo_mpct` | `--algorithm elo --scoring match_pct` |

**`openskill_mpct` — decay ablation baseline.**
The pure PL model without decay scores τ = 0.4009 vs PL+Decay's 0.4018 — a
difference of 0.0009, which is within noise. This confirms that decay is not
driving the PL family's dominance; it's the Plackett-Luce model form that
fits `match_pct` data well. The baseline also shows how well a parameter-free
model can do, which is relevant when assessing new complexity.

**`elo_mpct` — classical algorithm anchor.**
ELO (best config: K=48, min=16, decay=30) scores τ = 0.3847, beating all BT
variants but below PL. It provides a historical anchor to the chess/esports
tradition and validates that the Bayesian approach adds genuine value.
**Important:** ELO conservative metrics are unreliable due to a scale mismatch
bug (ELO uses a 1500-point scale, but `_conservative_rank()` uses OpenSkill
defaults of μ=25). Use only base ELO metrics for comparisons.

---

### Group C — Level-stratified variants (match_pct, L3+)

The same three core algorithms trained on L3+ matches only (National,
Continental, World). Enabled by the `--min-level l3` flag.

| Stored name | Command |
|---|---|
| `openskill_pl_decay_mpct_l3plus` | `--algorithm openskill_pl_decay --scoring match_pct --min-level l3` |
| `openskill_bt_lvl_decay_mpct_l3plus` | `--algorithm openskill_bt_lvl_decay --scoring match_pct --min-level l3` |
| `ics_mpct_l3plus` | `--algorithm ics --scoring match_pct --min-level l3` |

**Purpose — three distinct questions answered by pairing with Group A:**

| Pair | Question |
|---|---|
| `pl_decay_mpct` vs `pl_decay_mpct_l3plus` | Do L2 regional matches add signal or noise to the PL model? If the L3+ model scores higher, L2 data is diluting quality. If roughly equal, L2 is contributing useful signal. |
| `bt_lvl_decay_mpct` vs `bt_lvl_decay_mpct_l3plus` | Does level-weighting become redundant when L2 is already excluded? If the gap between PL and BT narrows on L3+ data, the level scaling was compensating for L2 noise rather than genuinely modelling match quality. |
| `ics_mpct` vs `ics_mpct_l3plus` | How sensitive is ICS to match selection? ICS 2.0 is officially intended for L3+ data. Training it on all levels (Group A) vs. its intended data (Group C) gives a direct assessment of whether our all-data ICS is a fair comparison or an unfair one. |

**Why not l4plus?** Continental and World Championships combined total roughly
20–40 matches. That's too sparse for stable Bayesian ratings — sigma never
converges for shooters with fewer than 3 events in the training window. An
l4plus experiment is meaningful as a one-off research question but should not
be part of the routine training set.

---

### Group D — Orthogonal signals

| Stored name | Command |
|---|---|
| `openskill_pl_decay_mpct_combined` | `--algorithm openskill_pl_decay --scoring match_pct_combined` |
| `openskill_pl_decay` | `--algorithm openskill_pl_decay --scoring stage_hf` |
| `openskill_bt_lvl_decay` | `--algorithm openskill_bt_lvl_decay --scoring stage_hf` |

**`openskill_pl_decay_mpct_combined` — cross-division fairness.**
`match_pct_combined` normalises total match points by division weight before
ranking, making scores comparable across divisions (e.g. Production vs. Standard
can be directly compared). This is the right mode for a "best overall shooter"
question that crosses division boundaries. One model is enough — running all
algorithms in combined mode adds noise without new insight.

**`openskill_pl_decay` and `openskill_bt_lvl_decay` (stage_hf) — per-stage
signal.**
Stage HF treats each stage as an independent ranking event, giving 10× more
data points per match. The prior benchmarks (SSI-only, 300 matches) showed
BT winning this mode. With the full 2,039-match international dataset, PL
dominates on `match_pct`. Keeping both algorithms on `stage_hf` lets us track
whether this reversal holds as the dataset grows and whether stage-level data
eventually converges to the same conclusion as match-level data.

---

## What was cut and why

| Removed | Reason |
|---|---|
| `openskill_bt_mpct` | No level scaling, no decay. Strictly dominated by `bt_lvl_decay`. |
| `openskill_bt_lvl_mpct` | Superseded by `bt_lvl_decay`. The "no decay" ablation is already captured by `pl` vs `pl_decay`. |
| `openskill_bt` (stage_hf) | Same as above, in stage_hf mode. |
| `openskill_bt_lvl` (stage_hf) | Same. |
| `elo` (stage_hf) | ELO's conservative metrics are unreliable (scale bug) and its base metrics add nothing to stage_hf analysis that the two retained models don't already cover. |
| All `_combined` except PL+Decay | Running 6 algorithms in combined mode creates model clutter. The scoring mode insight is captured by one good model. |

To remove old models from DuckDB:

```bash
uv run rating clear-ratings \
  openskill_bt_mpct openskill_bt_lvl_mpct \
  openskill_bt openskill_bt_lvl \
  elo_combined openskill_pl_combined \
  openskill_bt_combined openskill_bt_lvl_combined openskill_bt_lvl_decay_combined
```

---

## Ready-to-run commands

### Full training run

Algorithms that share the same scoring mode and level filter are grouped into
a single command so they train in parallel (one worker per algorithm):

```bash
# Group A — all-data baselines (3 algorithms in parallel)
uv run rating train \
  --algorithm openskill_pl_decay,openskill_bt_lvl_decay,ics \
  --scoring match_pct && \

# Group B — algorithm baselines (2 algorithms in parallel)
uv run rating train \
  --algorithm openskill,elo \
  --scoring match_pct && \

# Group C — L3+ stratified (3 algorithms in parallel)
uv run rating train \
  --algorithm openskill_pl_decay,openskill_bt_lvl_decay,ics \
  --scoring match_pct --min-level l3 && \

# Group D — orthogonal signals
uv run rating train \
  --algorithm openskill_pl_decay \
  --scoring match_pct_combined && \
uv run rating train \
  --algorithm openskill_pl_decay,openskill_bt_lvl_decay \
  --scoring stage_hf
```

5 commands instead of 11; Groups A, B, C, and the stage_hf pair all use
parallel workers automatically.

### Benchmark

All three commands support `--date-from`, `--date-to`, and `--min-level`.
The 70/30 train/test split is applied within the filtered match window.

```bash
# Full dataset
uv run rating benchmark --scoring match_pct
uv run rating benchmark --scoring stage_hf
uv run rating benchmark --scoring all   # both modes, one table

# L3+ only
uv run rating benchmark --scoring match_pct --min-level l3

# Calendar-year window — e.g. 2025 only
uv run rating benchmark --scoring match_pct \
  --date-from 2025-01-01 --date-to 2025-12-31

# Combined: 2025 matches at L3+
uv run rating benchmark --scoring match_pct \
  --date-from 2025-01-01 --date-to 2025-12-31 --min-level l3
```

### Hyperparameter sweep

All three flags (`--date-from`, `--date-to`, `--min-level`) are available
on `tune` as well. Run each scoring mode / filter combination independently
— they are fully independent and can be distributed across machines:

```bash
# All-data sweep
uv run rating tune --scoring match_pct
uv run rating tune --scoring stage_hf

# L3+ stratified sweep — do optimal hyperparameters shift when L2 is excluded?
uv run rating tune --scoring match_pct --min-level l3

# 2025-only sweep — how well do the defaults hold on recent data alone?
uv run rating tune --scoring match_pct \
  --date-from 2025-01-01 --date-to 2025-12-31

# Merge results from all runs into one ranked table
uv run rating tune-merge
```

The L3+ and date-windowed sweeps are both targets for the next tuning report.
Key questions they can answer:
- Do `tau` or `level_scale` shift when L2 matches are excluded? If yes, those
  hyperparameters were compensating for L2 data noise, not modelling skill dynamics.
- Do the all-time optimal hyperparameters still hold on 2025-only data? If not,
  the model may benefit from a recency-aware retuning cadence.

---

### Seasonal snapshot models (optional)

Date-filtered training is most useful when you want a "current season" view
that ignores long historical tails — e.g. for team selection where only recent
form matters. These are not part of the core 11-model set but can be added
alongside it:

```bash
# 2025 season — primary algorithm only, all levels
uv run rating train \
  --algorithm openskill_pl_decay,openskill_bt_lvl_decay,ics \
  --scoring match_pct \
  --date-from 2025-01-01 --date-to 2025-12-31
# → stored as openskill_pl_decay_mpct_2025, openskill_bt_lvl_decay_mpct_2025, ics_mpct_2025

# 2025 season, L3+ only (highest-signal recent data)
uv run rating train \
  --algorithm openskill_pl_decay,openskill_bt_lvl_decay,ics \
  --scoring match_pct \
  --date-from 2025-01-01 --date-to 2025-12-31 --min-level l3
# → stored as openskill_pl_decay_mpct_l3plus_2025, etc.
```

The auto-generated suffix combines level and date when both are set:
`_mpct_l3plus_2025` for `--min-level l3 --date-from 2025-01-01 --date-to 2025-12-31`.
Use `--label` to override this if you prefer a shorter name.

---

## Comparison table (summary)

| Model | Kendall τ (2026-03-08) | Primary purpose |
|---|---|---|
| `pl_decay_mpct` | **0.4018** | Primary ranking algorithm |
| `openskill_mpct` | 0.4009 | Decay ablation — shows decay adds ~nothing numerically |
| `elo_mpct` | 0.3847 | Classical baseline |
| `bt_lvl_decay_mpct` | 0.3742 | Level-weighted comparison; useful for uncertainty flagging |
| `ics_mpct` | — | Non-parametric official method benchmark |
| `pl_decay_mpct_l3plus` | TBD | L3+ vs all-data signal comparison |
| `bt_lvl_decay_mpct_l3plus` | TBD | Level scaling redundancy test on filtered data |
| `ics_mpct_l3plus` | TBD | ICS on its intended data |
| `pl_decay_mpct_combined` | TBD | Cross-division ranking |
| `pl_decay` (stage_hf) | TBD | Per-stage signal |
| `bt_lvl_decay` (stage_hf) | TBD | Stage-level BT vs PL comparison |

TBD cells are targets for the next tuning report. The 2026-03-08 report covers
only the all-data `match_pct` sweep; the next report will extend this to the
L3+ sweep and stage_hf mode to fill in the table.

---

## Further reading

- [docs/algorithms.md](algorithms.md) — technical reference for every algorithm
- [docs/tuning-report-2026-03-08.md](tuning-report-2026-03-08.md) — benchmark
  results that established the Group A/B rankings above
