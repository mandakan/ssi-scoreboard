# CLAUDE.md — SSI Data Science Lab

Python data science lab for IPSC skill rating algorithms. Isolated from the
Next.js app — different language, toolchain, and runtime.

## Dev Commands

```bash
cd lab
uv sync                        # install/update deps
uv run rating sync --full      # pull data from app
uv run rating train            # train all algorithms
uv run rating benchmark        # compare algorithms
uv run rating serve            # start FastAPI server on :8000
uv run pytest                  # run tests
uv run ruff check src/         # lint
uv run mypy src/               # type check
```

## Project Structure

```
lab/
├── src/
│   ├── cli.py              # typer CLI: sync, train, benchmark, serve
│   ├── data/
│   │   ├── models.py       # Pydantic models
│   │   ├── sync.py         # httpx client, incremental sync
│   │   └── store.py        # DuckDB local store
│   ├── algorithms/
│   │   ├── base.py         # ABC: process_match, get_ratings, predict_rank
│   │   ├── openskill_pl.py # OpenSkill Plackett-Luce
│   │   └── elo.py          # Multi-player ELO baseline
│   ├── benchmark/
│   │   ├── runner.py       # Chronological train/test split
│   │   ├── metrics.py      # Kendall tau, top-k accuracy, MRR
│   │   └── report.py       # rich tables + matplotlib charts
│   └── engine/
│       ├── main.py         # FastAPI rating server
│       └── scheduler.py    # APScheduler recalc
├── tests/
├── notebooks/
└── data/                   # DuckDB files (gitignored)
```

## Data Source

Match data comes from the main app's admin-only API:
- `GET /api/data/matches` — list cached matches with metadata
- `GET /api/data/match/{ct}/{id}/results` — full stage results for all competitors

Auth: `Authorization: Bearer <CACHE_PURGE_SECRET>` (same secret as cache admin).
These endpoints are read-only — they never trigger GraphQL calls to the upstream API.

## Key Concepts

- **shooter_id** is the globally stable identity key across matches (from SSI's ShooterNode)
- **competitor_id** is per-match (a competitor in match X has a different ID than in match Y)
- **hit_factor** = points / time — the primary performance metric in IPSC
- Rankings use hit factor, not raw points (points are not comparable across divisions/stages)
- DQ = disqualified (HF treated as 0), DNF = did not fire (excluded from rankings)

## Algorithm Convention

All algorithms implement `RatingAlgorithm` ABC from `src/algorithms/base.py`:
- `process_match(match)` — update ratings from one match's results
- `get_ratings()` → dict[shooter_id, Rating]
- `predict_rank(shooter_ids)` → predicted ordering
- `save_state(path)` / `load_state(path)` — serialize/deserialize

Matches are fed chronologically. Each stage is an independent ranking event.

## DuckDB Schema

Local analytical database in `data/lab.duckdb`. Tables:
- `matches` — match metadata (PK: ct, match_id)
- `competitors` — per-match competitors with shooter_id (PK: ct, match_id, competitor_id)
- `stages` — stage metadata (PK: ct, match_id, stage_id)
- `stage_results` — per-competitor per-stage results (PK: ct, match_id, competitor_id, stage_id)
- `shooter_ratings` — computed ratings per algorithm (PK: algorithm, shooter_id)
- `rating_history` — rating snapshots after each match

## Code Conventions

- Python 3.13+, strict mypy, ruff for linting
- Pydantic v2 for data validation
- Type hints on all function signatures
- Tests in `tests/` using pytest
