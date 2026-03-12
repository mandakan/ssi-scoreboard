# SSI Scoreboard — Data Science Lab

A pipeline that collects IPSC competition results from two public sources,
resolves shooter identities across them, computes skill ratings, and produces
an interactive explorer used for national team selection analysis.

---

## What this system does (plain language)

**The problem:** Swedish IPSC shooters compete at Regional matches (tracked in
SSI Scoreboard) and at National/Continental/World matches (published on
ipscresults.org). These two databases have no shared identity system — the same
person appears as a numeric ID in one and as a name in the other. To fairly rank
shooters across their full competitive history, the two must be connected.

**The pipeline, step by step:**

```
① Sync SSI Scoreboard          Pull all L2+ Regional match results via the admin API.
                                Each competitor has a stable numeric shooter_id.

② Sync ipscresults.org         Pull all L3–L5 international match results via
                                the public OData API. ~2,000 matches back to 2009.
                                Competitors identified by name + region only.

③ Link identities              Match ipscresults competitors to SSI identities using
                                exact name matching, alias matching, and fuzzy similarity.
                                Flag uncertain matches for human review.

④ Curate uncertain links        Open the Identity tab in the explorer and review
                                fuzzy-matched pairs. Approve correct links; reject
                                incorrect ones (wrong pairings get split into separate
                                records and are never re-merged automatically).

⑤ Train rating algorithms       Feed all match results (chronologically) through six
                                skill rating models. Algorithms see only canonical IDs —
                                the identity resolution is transparent to them.

⑥ Export static explorer        Build a single HTML file with embedded data. Tabs:
                                Team Selection · Rankings · Matches · Identity · About.

⑦ Interpret results             Use the Team Selection tab to identify the strongest
                                candidates per division for national team selection,
                                filtered by region, activity period, and minimum matches.
```

**What the ratings represent:** A rating is an estimate of a shooter's current
skill level based on their entire competitive history. The system uses a
Bayesian model (OpenSkill) that accounts for uncertainty — a shooter with 3
matches has a wider uncertainty band than one with 40. For team selection, the
**conservative ranking** (`μ − 0.52σ`) is used: it penalises low match counts and
rewards consistent performance over time. See [docs/algorithms.md](docs/algorithms.md)
for a full explanation.

**How to interpret the Team Selection tab:**
- The list shows the top candidates per division, filtered to your chosen region.
- Sort by **Conservative** (default) for team selection — it avoids over-promoting
  shooters with very few results.
- Use **Min matches** (default: 3) and **Active since** to require a meaningful
  track record and recent activity.
- Numbers shown: `μ` = mean rating, `σ` = uncertainty, `CR` = conservative rating,
  `M` = career matches.

---

## Quick start

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

cd lab
uv sync
uv sync --extra storage   # optional — needed for db-push / db-pull / S3 sync

# Option A: download a pre-built shared database (skips the ~1h full sync)
export LAB_S3_BUCKET=my-lab-bucket
export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  # R2 only
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
uv run rating db-pull
uv run rating raw-pull    # optional but recommended — enables instant future re-syncs

# Option B: one-command pipeline (sync both sources → link → train → export)
uv run rating pipeline --token YOUR_CACHE_PURGE_SECRET

# Option C: step by step
uv run rating sync --token YOUR_CACHE_PURGE_SECRET    # pull SSI match data
uv run rating sync-ipscresults                        # pull ipscresults.org data
uv run rating link                                    # resolve identities + deduplicate
uv run rating train                                   # train all algorithms
uv run rating export                                  # build static explorer

# Start the live rating server (includes approve/reject endpoints for identity curation)
uv run rating serve
# Then open http://localhost:8000 in a browser

# After syncing new data, share the updated database with collaborators
uv run rating db-push
uv run rating raw-push
```

---

## Recommended curation workflow

After a sync, some ipscresults competitors will be fuzzy-matched to SSI
identities with lower confidence. These should be reviewed before the ratings
are used for team selection:

```bash
uv run rating sync-ipscresults   # pull latest international results
uv run rating link               # re-resolve identities
uv run rating train              # recompute ratings
uv run rating export             # rebuild explorer with updated data

uv run rating serve              # open http://localhost:8000 → Identity tab
# Review and approve/reject uncertain links in the browser

# After reviewing, apply any rejections to the ratings:
uv run rating link               # manual overrides from rejections are preserved
uv run rating train
uv run rating export
```

See [docs/identity-curation.md](docs/identity-curation.md) for a complete guide
to the Identity tab — what confidence scores mean, how to prioritise your review,
and how to handle edge cases like name changes.

---

## Development

```bash
uv run pytest               # Run tests
uv run ruff check src/      # Lint
uv run mypy src/            # Type check
```

## Docker (production)

```bash
docker compose up engine              # Rating engine on :8000
docker compose --profile jupyter up   # + Jupyter on :8888
```

---

## Architecture

```
src/data/
  sync.py              SSI Scoreboard admin API client (L2+ matches, bearer token)
  ipscresults.py       ipscresults.org OData client (L3–L5 matches, public)
  raw_store.py         Tiered raw bundle cache — local file → S3/R2 → remote API
  identity.py          Cross-source shooter identity resolution (exact + alias + fuzzy)
  match_dedup.py       Cross-source match deduplication (name similarity + date)
  store.py             Multi-source DuckDB store (schema v5)
  exporter.py          Serialises store data to JSON for the static explorer

src/algorithms/
  base.py              RatingAlgorithm ABC
  openskill_pl.py      OpenSkill Plackett-Luce variants (PL, BT, +Level, +Decay)
  elo.py               Multi-player ELO baseline

src/benchmark/
  runner.py            Chronological train/test split
  metrics.py           Kendall tau, top-k accuracy, MRR
  report.py            Rich tables + matplotlib charts

src/engine/
  main.py              FastAPI server (ratings API + identity approve/reject endpoints)
  page.py              Static HTML explorer generator (Team Selection, Rankings,
                       Matches, Identity, About tabs)
  scheduler.py         APScheduler background recalculation

src/cli.py             Typer CLI (sync, sync-ipscresults, link, link-shooter,
                       train, benchmark, serve, export, pipeline,
                       db-push, db-pull, raw-push, raw-pull)
```

### DuckDB tables (schema v5)

| Table | Contents | Persistent? |
|-------|----------|-------------|
| `sync_state` | Sync watermarks, schema version, identity sequence | ✓ always |
| `identity_reviews` | Human approve/reject decisions for fuzzy links | ✓ always |
| `matches` | Match metadata from both sources | recreated on schema bump |
| `competitors` | Per-match competitor rows with `identity_key` and `alias` | recreated |
| `stages` / `stage_results` | Stage metadata and per-competitor results | recreated |
| `shooter_identities` | One row per canonical real-world person | recreated |
| `shooter_identity_links` | Source key → canonical_id mapping with method + confidence | recreated |
| `match_links` | Cross-source duplicate match pairs | recreated |
| `shooter_ratings` | Computed ratings per algorithm | recreated |
| `rating_history` | Rating snapshots after each match | recreated |

`identity_reviews` is **never dropped** — human decisions survive every re-link and schema migration.

---

## Data sources

### SSI Scoreboard (primary — L2+ Regional matches)

```
Main App (D1/SQLite) → GET /api/data/matches → sync → DuckDB (local)
                     → GET /api/data/match/{ct}/{id}/results
```

Requires `CACHE_PURGE_SECRET` bearer token. Each SSI competitor has a stable
integer `shooter_id` used as their global identity.

### ipscresults.org (secondary — L3–L5 National/Continental/World)

```
https://ipscresults.org/odata/ → sync-ipscresults → DuckDB (local)
```

Public OData v4 API — no authentication required. Covers ~1,250 international
matches back to 2009. Competitors are identified by name + region only; the `link`
step resolves these to canonical IDs via fuzzy name matching against SSI.

---

## Identity resolution

After syncing both sources, `rating link` runs the `IdentityResolver`:

1. **Bootstrap SSI** — every SSI `shooter_id` becomes a `canonical_id`. All name
   variants for that shooter are registered as lookup fingerprints.

2. **Link ipscresults** — for each unlinked `(name, region, alias)` triplet, try
   in order: exact fingerprint match → alias match (confidence 0.95) → fuzzy
   SequenceMatcher match (threshold 0.85 overall, > 0.75 per first/last name token)
   → allocate a new `canonical_id ≥ 2,000,000`.

3. **Manual overrides** — `rating link-shooter` creates `method='manual'` links that
   are **never** overwritten. Rejecting a link in the explorer UI also creates a
   manual override automatically.

**Fuzzy match quality filters** prevent common false positives:
- Per-token minimum > 0.75 stops `Thomas Larsen` matching `Thomas Olaussen` (shared first name)
- Digit stripping handles ipscresults names with embedded registration numbers

See [docs/identity-curation.md](docs/identity-curation.md) for the full curation
guide and [docs/algorithms.md](docs/algorithms.md) for algorithm details.

### Match deduplication

The same L3+ competition often appears in both sources. `rating link` detects
duplicates by name similarity (≥ 0.80) + date proximity (±3 days) and marks the
non-preferred copy for exclusion from training. Preference order: more stages >
more competitors > SSI over ipscresults.

---

## Further reading

| Document | Audience |
|----------|---------|
| [docs/identity-curation.md](docs/identity-curation.md) | Anyone reviewing fuzzy matches in the Identity tab |
| [docs/algorithms.md](docs/algorithms.md) | Technical reference: all algorithms, scoring modes, tuning methodology |
| [docs/model-set.md](docs/model-set.md) | Canonical 11-model reference set — what to train, why, and ready-to-run commands |
| [docs/tuning-report-2026-03-08.md](docs/tuning-report-2026-03-08.md) | Latest benchmark results across all configurations |
