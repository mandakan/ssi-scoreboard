# SSI Scoreboard — Data Science Lab

Python-based data science lab for developing, benchmarking, and deploying
skill rating algorithms for IPSC shooting competitions.

## Quick start

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies
cd lab
uv sync

# Sync match data from the app
uv run rating sync --url http://localhost:3000 --token YOUR_CACHE_PURGE_SECRET

# Train rating algorithms
uv run rating train

# Run benchmarks
uv run rating benchmark

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

- `src/data/` — Pydantic models, DuckDB store, HTTP sync client
- `src/algorithms/` — Rating algorithm implementations (OpenSkill, ELO)
- `src/benchmark/` — Chronological train/test evaluation framework
- `src/engine/` — FastAPI rating server with scheduled recalculation
- `src/cli.py` — Typer CLI (`rating sync|train|benchmark|serve`)

## Data flow

```
Main App (D1/SQLite) → GET /api/data/matches → sync → DuckDB (local)
                     → GET /api/data/match/{ct}/{id}/results
```

The sync client pulls match results from the main app's admin-only
data API endpoints. Authentication uses the same `CACHE_PURGE_SECRET`
bearer token as other admin endpoints.
