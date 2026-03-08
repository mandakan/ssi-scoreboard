# CLAUDE.md — SSI Data Science Lab

Python data science lab for IPSC skill rating algorithms. Isolated from the
Next.js app — different language, toolchain, and runtime.

## Dev Commands

```bash
cd lab
uv sync                                       # install/update deps
uv sync --extra storage                       # also install boto3 (for db-push/db-pull)

# Bootstrap from shared DB (first time, avoids re-running the ~1h full sync)
uv run rating db-pull                         # download latest DuckDB from R2/S3

# Sync data (both sources) — run after bootstrap to pick up new matches
uv run rating sync --token $CACHE_PURGE_SECRET              # pull SSI match data
uv run rating sync-ipscresults                              # pull ipscresults.org data
uv run rating link                                          # resolve identities + deduplicate

# Or run everything in one go
uv run rating pipeline --token $CACHE_PURGE_SECRET

# Train, benchmark, serve
uv run rating train                           # train all algorithms
uv run rating benchmark                       # compare algorithms
uv run rating serve                           # start FastAPI server on :8000

# Share updated DB after a sync
uv run rating db-push                         # upload to R2/S3

# Checks
uv run pytest                                 # run tests
uv run ruff check src/                        # lint
uv run mypy src/                              # type check
```

## Project Structure

```
lab/
├── src/
│   ├── cli.py              # typer CLI: sync, sync-ipscresults, link, train, benchmark, serve
│   ├── data/
│   │   ├── models.py       # Pydantic models (MatchResults, CompetitorMeta, etc.)
│   │   ├── sync.py         # SSI scoreboard HTTP sync client
│   │   ├── ipscresults.py  # ipscresults.org OData sync client
│   │   ├── ipscresults_models.py  # Pydantic models for ipscresults OData API
│   │   ├── identity.py     # Cross-source shooter identity resolution
│   │   ├── match_dedup.py  # Cross-source match deduplication
│   │   ├── store.py        # DuckDB local store (multi-source, schema v2)
│   │   └── exporter.py     # Export ratings + matches to JSON for static site
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
│   ├── test_store.py           # DuckDB store (multi-source, identity, dedup)
│   ├── test_identity.py        # Cross-source identity resolution
│   ├── test_match_dedup.py     # Match deduplication heuristics
│   ├── test_ipscresults.py     # ipscresults OData client + syncer
│   ├── test_algorithms.py      # Rating algorithm correctness
│   └── test_metrics.py         # Benchmark metric functions
├── notebooks/
└── data/                   # DuckDB files (gitignored)
```

## Data Sources

### SSI Scoreboard (primary)
Match data from the main app's admin-only API:
- `GET /api/data/matches` — list cached matches with metadata
- `GET /api/data/match/{ct}/{id}/results` — full stage results

Auth: `Authorization: Bearer <CACHE_PURGE_SECRET>`
Mostly L2 (Regional) matches with rich per-field data. Uses stable integer `shooter_id`.

### ipscresults.org (secondary)
Public OData v4 API at `https://ipscresults.org/odata/` — no authentication required.
Covers L3–L5 (National/Continental/World) matches globally, back to 2009.
No global shooter IDs — competitors are identified by name + region only.

After syncing both sources, run `rating link` to resolve shooter identities across
sources and mark cross-source duplicate matches for deduplication during training.

## Key Concepts

- **canonical_id** — globally stable identity key used for ratings. For SSI shooters
  this equals their `shooter_id`. ipscresults-only shooters get IDs ≥ 2,000,000.
- **shooter_id** — SSI-specific stable integer for a real-world person
- **competitor_id** — per-match (a competitor in match X has a different ID than in match Y)
- **identity_key** — `str(shooter_id)` for SSI; `"normalized_name|REGION"` fingerprint for ipscresults
- **hit_factor** = points / time — the primary performance metric in IPSC
- Rankings use hit factor, not raw points (points are not comparable across divisions/stages)
- DQ = disqualified (HF treated as 0), DNF = did not fire (excluded from rankings)

## Identity Resolution

`rating link` runs `IdentityResolver` which maps source-specific identities to a
single `canonical_id` per real-world person:

1. **Bootstrap SSI** — each SSI `shooter_id` becomes a `canonical_id`. All name variants
   seen for that `shooter_id` are registered as fingerprints under `source='ssi_fp'`.
   Written via PyArrow bulk insert (fast — ~0.5s for 7,500 shooters).
2. **Link ipscresults** — for each unlinked `(name, region)` pair:
   - **Name normalisation**: `"Last, First"` → `"First Last"`, then `strip_diacritics()`
     (handles NFD combining marks *and* non-decomposing Nordic chars: Ø→O, Æ→AE, Å→A,
     ß→ss), then lowercase + `name_fingerprint()` → `"normalized name|REGION"`
   - **Exact match**: fingerprint looked up in `ssi_fp` link table → `confidence=1.0`
   - **Fuzzy match**: `difflib.SequenceMatcher` against all SSI fingerprints in the same
     region. Accepted only if **both** hold:
     - Overall ratio **≥ 0.85** (`_FUZZY_THRESHOLD`)
     - Per-token minimum **> 0.75** (`_TOKEN_MIN_RATIO`, strictly greater): first (given)
       and last (family) name tokens compared independently; digit sequences stripped first
       to handle embedded registration numbers (`Anders1406` → `Anders`). This prevents
       false matches where people share only a first or only a last name — a common failure
       mode with Scandinavian surnames that share suffixes (-berg, -ström, -ssen).
     - Saved with `confidence=<ratio>, method='auto_fuzzy'`
   - **New identity**: allocate `canonical_id ≥ 2,000,000`; saved as `method='auto_exact'`
   - Fuzzy matching runs in **parallel workers** (one chunk per CPU core) for speed.
3. **Manual overrides** — `rating link-shooter` creates `method='manual'` links that
   are never overwritten by automatic resolution. Use for name changes, aliases, or
   mismatches the fuzzy matcher cannot resolve.

**Transparency**: `rating export` includes an **Identity tab** in the static explorer
listing all `auto_fuzzy` links sorted by confidence ascending. Review low-confidence
entries (< 0.90, shown in red) and correct them with `rating link-shooter`.

**Key constants** (all in `src/data/identity.py`):
- `_FUZZY_THRESHOLD = 0.85` — minimum overall SequenceMatcher ratio
- `_TOKEN_MIN_RATIO = 0.75` — minimum per-token ratio (strictly greater than)

**Deferred ambiguous divisions** — see `src/data/divisions.py` for a documented list of
division name variants that are not yet merged and the rationale for each.

## Match Deduplication

The same L3+ match can appear in both SSI and ipscresults. `rating link` detects these
via name similarity (SequenceMatcher ≥ 0.80) + date proximity (±3 days) across sources.
Confirmed duplicates are stored in `match_links` with a preferred side. The non-preferred
copy is added to the dedup skip set and excluded from training automatically.

## Algorithm Convention

All algorithms implement `RatingAlgorithm` ABC from `src/algorithms/base.py`:
- `process_match_data(ct, match_id, date, results, comp_map, ...)` — update ratings
- `get_ratings()` → `dict[canonical_id, Rating]`
- `predict_rank(shooter_ids)` → predicted ordering
- `save_state(path)` / `load_state(path)` — serialize/deserialize

Matches are fed chronologically from all sources combined. Canonical IDs unify
competitors across SSI and ipscresults — algorithms see only integers, not sources.

## DuckDB Schema (v2)

Local analytical database in `data/lab.duckdb`. All data tables include a `source` column.

**Data tables** (dropped and recreated on `SCHEMA_VERSION` bump):
- `matches` — match metadata (PK: **source**, ct, match_id)
- `competitors` — per-match competitors; `identity_key` is the cross-source join key (PK: source, ct, match_id, competitor_id)
- `stages` — stage metadata (PK: source, ct, match_id, stage_id)
- `stage_results` — per-competitor per-stage results (PK: source, ct, match_id, competitor_id, stage_id)
- `shooter_identities` — one row per canonical person (PK: canonical_id)
- `shooter_identity_links` — maps source-specific key → canonical_id (PK: source, source_key)
- `match_links` — cross-source duplicate pairs with preferred side (PK: source_a, match_id_a, source_b, match_id_b)
- `shooter_ratings` — computed ratings per algorithm (PK: algorithm, shooter_id)
- `rating_history` — rating snapshots after each match

**Persistent table** (never dropped):
- `sync_state` — sync watermarks per source (`last_sync_ssi`, `last_sync_ipscresults`), schema version, identity sequence counter

## DB Bootstrap (S3/R2)

Syncing from scratch takes ~1h. Share a pre-built DuckDB via S3-compatible storage
so collaborators and CI can skip the full sync.

```bash
# Install storage extras
uv sync --extra storage

# Set credentials (standard AWS env vars — works for both S3 and Cloudflare R2)
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export LAB_S3_BUCKET=my-lab-bucket

# Cloudflare R2 only — set the account endpoint
export LAB_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com

# Optional: key prefix inside the bucket (default: "lab")
export LAB_S3_PREFIX=lab
```

**Uploading** (after a sync, to share with others):
```bash
uv run rating db-push
```
Uploads `data/lab.duckdb.gz` and a `manifest.json` with match counts and watermarks.

**Downloading** (first time, or to sync another machine):
```bash
uv run rating db-pull          # prompts before overwriting if local is newer
uv run rating db-pull --yes    # skip prompt (for CI/scripts)
```
Downloads and decompresses into `data/lab.duckdb`. The safety check compares local
match count and sync watermarks against the manifest — if local has more data you
are asked to confirm before the local file is overwritten.

**Inspect the manifest directly:**
```bash
aws s3 cp s3://$LAB_S3_BUCKET/lab/manifest.json - \
  --endpoint-url $LAB_S3_ENDPOINT | python -m json.tool
```

**Inspect skipped matches in the local DB:**
```sql
SELECT name, skip_reason FROM matches WHERE skip_reason IS NOT NULL;
```

## Code Conventions

- Python 3.13+, strict mypy, ruff for linting
- Pydantic v2 for data validation
- Type hints on all function signatures
- Tests in `tests/` using pytest
- `source` is always the first parameter to all store methods that are source-scoped
