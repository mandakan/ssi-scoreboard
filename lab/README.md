# SSI Scoreboard — Data Science Lab

Python-based data science lab for developing, benchmarking, and deploying
skill rating algorithms for IPSC shooting competitions.

## Quick start

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

cd lab
uv sync
uv sync --extra storage   # optional — needed for db-push / db-pull

# Option A: download a pre-built shared DuckDB (skips the ~1h full sync)
export LAB_S3_BUCKET=my-lab-bucket
export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  # R2 only
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
uv run rating db-pull

# Option B: one-command pipeline (sync both sources → link → train → export)
uv run rating pipeline --token YOUR_CACHE_PURGE_SECRET

# Option C: step by step
uv run rating sync --token YOUR_CACHE_PURGE_SECRET    # pull SSI match data
uv run rating sync-ipscresults                        # pull ipscresults.org data
uv run rating link                                    # resolve identities + deduplicate
uv run rating train                                   # train all algorithms
uv run rating benchmark                               # compare algorithms
uv run rating export                                  # build static explorer

# After syncing new data, share the updated DB
uv run rating db-push

# Start the rating API server
uv run rating serve
```

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

## Architecture

- `src/data/` — Pydantic models, DuckDB store, sync clients for both data sources
  - `sync.py` — SSI Scoreboard admin API client (L2+ matches, bearer token auth)
  - `ipscresults.py` — ipscresults.org OData client (L3–L5 matches, public API)
  - `identity.py` — Cross-source shooter identity resolution (exact + fuzzy name matching)
  - `match_dedup.py` — Cross-source match deduplication (name similarity + date proximity)
  - `store.py` — Multi-source DuckDB store with canonical identity tables (schema v2)
- `src/algorithms/` — Rating algorithm implementations (OpenSkill PL/BT variants, ELO)
- `src/benchmark/` — Chronological train/test evaluation with conservative ranking and per-division fairness analysis
- `src/engine/` — FastAPI rating server with scheduled recalculation
- `src/cli.py` — Typer CLI (`rating sync|sync-ipscresults|link|link-shooter|train|benchmark|serve|pipeline`)

See [docs/algorithms.md](docs/algorithms.md) for a plain-language explanation of every
algorithm: what it does, why it was chosen, its strengths, weaknesses, and parameter
rationale.

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

### Identity resolution + deduplication

After syncing both sources, run `rating link` to:
1. Map every SSI `shooter_id` to a `canonical_id`
2. Link ipscresults competitors to SSI identities (exact + fuzzy name matching)
3. Detect matches that appear in both sources and mark the non-preferred copy for exclusion

Training always uses canonical IDs — algorithms see a single unified set of
shooters regardless of which source(s) they appeared in.
