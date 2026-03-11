# CLAUDE.md — SSI Data Science Lab

Python data science lab for IPSC skill rating algorithms. Isolated from the
Next.js app — different language, toolchain, and runtime.

## Dev Commands

```bash
cd lab
uv sync                                       # install/update deps
uv sync --extra storage                       # also install boto3 (for S3/R2 commands)

# Bootstrap from shared DB + raw bundle cache (first time, avoids re-running the ~1h full sync)
uv run rating db-pull                         # download latest DuckDB from R2/S3
uv run rating raw-pull                        # download raw OData bundles (makes re-syncs instant)

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

# Share updated DB and raw bundle cache after a sync
uv run rating db-push                         # upload DuckDB to R2/S3
uv run rating raw-push                        # upload new raw bundle files to R2/S3

# Checks
uv run pytest                                 # run tests
uv run ruff check src/                        # lint
uv run mypy src/                              # type check
```

## Project Structure

```
lab/
├── src/
│   ├── cli.py              # typer CLI: sync, sync-ipscresults, link, train, benchmark, serve,
│   │                       #            db-push, db-pull, raw-push, raw-pull
│   ├── data/
│   │   ├── models.py       # Pydantic models (MatchResults, CompetitorMeta, etc.)
│   │   ├── sync.py         # SSI scoreboard HTTP sync client
│   │   ├── ipscresults.py  # ipscresults.org OData sync client + IpscResultsSyncer
│   │   ├── ipscresults_models.py  # Pydantic models for ipscresults OData API
│   │   ├── raw_store.py    # Raw OData bundle cache — local file + optional S3/R2
│   │   ├── identity.py     # Cross-source shooter identity resolution
│   │   ├── match_dedup.py  # Cross-source match deduplication
│   │   ├── store.py        # DuckDB local store (multi-source, schema v5)
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
│   ├── test_raw_store.py       # RawMatchStore — local cache + S3 tiered loading
│   ├── test_algorithms.py      # Rating algorithm correctness
│   └── test_metrics.py         # Benchmark metric functions
├── notebooks/
└── data/                   # DuckDB + raw bundle files (gitignored)
    ├── lab.duckdb
    └── ipscresults-raw/    # one .json.gz per ipscresults match
```

## Data Sources

### SSI Scoreboard (primary)
Match data from the main app's admin-only API:
- `GET /api/data/matches` — list cached matches with metadata
- `GET /api/data/match/{ct}/{id}/results` — full stage results

Auth: `Authorization: Bearer <CACHE_PURGE_SECRET>`
Mostly L2 (Regional) matches with rich per-field data. Uses stable integer `shooter_id`.
The API also exposes `icsAlias` — the shooter's ICS/ipscresults alias — which is stored
as `alias` in the `competitors` table and used during identity resolution (see below).

### ipscresults.org (secondary)
Public OData v4 API at `https://ipscresults.org/odata/` — no authentication required.
Covers L3–L5 (National/Continental/World) matches globally, back to 2009.
No global shooter IDs — competitors are identified by name + region only.
The API exposes a user `Alias` field which is stored and used for cross-source matching.

After syncing both sources, run `rating link` to resolve shooter identities across
sources and mark cross-source duplicate matches for deduplication during training.

## Raw OData Bundle Cache

Every ipscresults match fetched from the remote API is stored as a gzip-compressed JSON
file (`data/ipscresults-raw/{match_id}.json.gz`). This serves two purposes:

1. **Fast re-syncs** — `sync-ipscresults` loads from the local file instead of hitting the
   network. Re-processing all ~2,000 matches takes seconds instead of hours.
2. **Future-proofing** — raw OData responses are preserved in full, so new fields can be
   extracted by re-parsing local files without any API calls.

The files follow the bundle format defined in `src/data/raw_store.py` (`BUNDLE_SCHEMA_VERSION`).
They are valid inputs for the Next.js scoreboard app too (e.g. for achievement calculations).

### Tiered load order (per match, during sync)

```
1. Local file  →  data/ipscresults-raw/{match_id}.json.gz  (instant)
2. S3/R2       →  {prefix}/ipscresults/raw/{match_id}.json.gz  (downloaded + cached locally)
3. Remote API  →  ipscresults.org OData  (slow; saved to local file and S3 after fetch)
```

### sync-ipscresults options for the raw cache

```bash
uv run rating sync-ipscresults \
  --raw-dir data/ipscresults-raw \   # local cache dir (default; set to "" to disable)
  --bucket  my-lab-bucket \          # S3/R2 bucket (LAB_S3_BUCKET env var)
  --prefix  lab \                    # key prefix (LAB_S3_PREFIX, default: lab)
  --endpoint https://...r2... \      # R2 endpoint (LAB_S3_ENDPOINT; omit for AWS S3)
```

When `--bucket` is set, bundles are uploaded to S3/R2 immediately after being fetched from
the API. The next machine that runs `raw-pull` (or `sync-ipscresults` with S3 configured)
will get those bundles from S3 instead of the remote API.

### raw-push / raw-pull

Transfer raw bundle files between the local cache and S3/R2, independently of the DuckDB.

```bash
# Upload local files not yet on S3 (never overwrites existing remote files)
uv run rating raw-push

# Download remote files missing locally (never overwrites existing local files)
uv run rating raw-pull

# Preview without transferring
uv run rating raw-push --dry-run
uv run rating raw-pull --dry-run
```

Both commands use the same S3 env vars as `db-push`/`db-pull` (see **DB Bootstrap** below).
The S3 key path is `{prefix}/ipscresults/raw/{match_id}.json.gz`, which is identical to
the path used by `RawMatchStore` when auto-downloading during sync — the two are compatible.

**Recommended bootstrap workflow (new machine or collaborator):**

```bash
uv sync --extra storage
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export LAB_S3_BUCKET=my-lab-bucket
export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  # R2 only

uv run rating db-pull          # get the DuckDB (processed data)
uv run rating raw-pull         # get raw bundle files (enables instant future re-syncs)
uv run rating sync --token $CACHE_PURGE_SECRET   # pick up any new SSI matches
uv run rating sync-ipscresults                   # pick up any new ipscresults matches
uv run rating link                               # resolve identities
```

**After a sync, share with others:**

```bash
uv run rating db-push          # share DuckDB
uv run rating raw-push         # share any newly fetched bundle files
```

## Key Concepts

- **canonical_id** — globally stable identity key used for ratings. For SSI shooters
  this equals their `shooter_id`. ipscresults-only shooters get IDs ≥ 2,000,000.
- **shooter_id** — SSI-specific stable integer for a real-world person
- **competitor_id** — per-match (a competitor in match X has a different ID than in match Y)
- **identity_key** — `str(shooter_id)` for SSI; `"normalized_name|REGION"` fingerprint for ipscresults
- **alias** — optional short handle stored alongside a competitor (ipscresults `Alias` field,
  or SSI `icsAlias`). Used as a secondary identity signal during cross-source linking.
- **hit_factor** = points / time — the primary performance metric in IPSC
- Rankings use hit factor, not raw points (points are not comparable across divisions/stages)
- DQ = disqualified (HF treated as 0), DNF = did not fire (excluded from rankings)

## Identity Resolution

`rating link` runs `IdentityResolver` which maps source-specific identities to a
single `canonical_id` per real-world person:

1. **Bootstrap SSI** — each SSI `shooter_id` becomes a `canonical_id`. All name variants
   seen for that `shooter_id` are registered as fingerprints under `source='ssi_fp'`.
   Written via PyArrow bulk insert (fast — ~0.5s for 7,500 shooters).
2. **Link ipscresults** — for each unlinked `(name, region, alias)` triplet:
   - **Name normalisation**: `"Last, First"` → `"First Last"`, then `strip_diacritics()`
     (handles NFD combining marks *and* non-decomposing Nordic chars: Ø→O, Æ→AE, Å→A,
     ß→ss), then lowercase + `name_fingerprint()` → `"normalized name|REGION"`
   - **Exact match**: fingerprint looked up in `ssi_fp` link table → `confidence=1.0`
   - **Alias match**: competitor's `alias` looked up in a combined alias index built from:
     - SSI competitors with `ics_alias` set (source='ssi', alias IS NOT NULL)
     - Existing ipscresults links with an alias
     Lookup is region-scoped. On hit → `confidence=0.95, method='auto_alias'`.
     Alias matching bridges SSI and ipscresults for shooters whose name normalisation
     fails (e.g. different romanisations of non-Latin names).
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

**`ResolveReport`** printed after `rating link` now includes an `Alias` count showing
how many ipscresults competitors were matched via alias rather than name.

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

## DuckDB Schema (v5)

Local analytical database in `data/lab.duckdb`. All data tables include a `source` column.

Schema version is stored in `sync_state.schema_version`. Migrations are additive (`ALTER
TABLE ADD COLUMN IF NOT EXISTS`) where possible; a full drop-and-recreate only happens on
breaking changes. The current version is **5**.

**Data tables** (dropped and recreated on `SCHEMA_VERSION` bump):
- `matches` — match metadata (PK: **source**, ct, match_id)
- `competitors` — per-match competitors; `identity_key` is the cross-source join key;
  `alias TEXT` stores ipscresults `Alias` / SSI `ics_alias` (PK: source, ct, match_id, competitor_id)
- `stages` — stage metadata (PK: source, ct, match_id, stage_id)
- `stage_results` — per-competitor per-stage results (PK: source, ct, match_id, competitor_id, stage_id)
- `shooter_identities` — one row per canonical person (PK: canonical_id)
- `shooter_identity_links` — maps source-specific key → canonical_id; `alias TEXT` stores
  the alias used when `method='auto_alias'` (PK: source, source_key)
- `match_links` — cross-source duplicate pairs with preferred side (PK: source_a, match_id_a, source_b, match_id_b)
- `shooter_ratings` — computed ratings per algorithm (PK: algorithm, shooter_id)
- `rating_history` — rating snapshots after each match

**`shooter_identity_links.method` values:**
| Value | Description |
|---|---|
| `auto_exact` | Name fingerprint matched exactly (or new identity allocated) |
| `auto_alias` | Matched via alias field (confidence 0.95) |
| `auto_fuzzy` | SequenceMatcher fuzzy match (confidence = ratio) |
| `manual` | Manual override via `rating link-shooter` — never overwritten |

**Persistent table** (never dropped):
- `sync_state` — sync watermarks per source (`last_sync_ssi`, `last_sync_ipscresults`), schema version, identity sequence counter

**Updating an existing database (schema v4 → v5):**

No manual steps needed. The store runs an automatic targeted migration on startup:

```sql
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS alias TEXT;
ALTER TABLE shooter_identity_links ADD COLUMN IF NOT EXISTS alias TEXT;
```

After migrating, run `rating sync-ipscresults --full` to re-fetch and re-parse all
ipscresults matches so the new `alias` column is populated. With raw bundle files already
on disk (via `raw-pull`), this re-parse is fast (no network calls).

Then run `rating link` to re-resolve identities with the new alias matching step.

## DB Bootstrap (S3/R2)

Syncing from scratch takes ~1h. Share a pre-built DuckDB and the raw bundle cache via
S3-compatible storage so collaborators and CI can skip the full sync.

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

### DuckDB (processed data)

**Uploading** (after a sync, to share with others):
```bash
uv run rating db-push
```
Uploads `data/lab.duckdb.gz` and a `manifest.json` with match counts and watermarks.
Also saves a versioned backup under `{prefix}/versions/` (default: keep last 10).

**Downloading** (first time, or to sync another machine):
```bash
uv run rating db-pull          # prompts before overwriting if local is newer
uv run rating db-pull --yes    # skip prompt (for CI/scripts)
uv run rating db-pull --version 20250307T142301   # restore a specific version
uv run rating db-versions      # list available versioned backups
```

**Inspect the manifest directly:**
```bash
aws s3 cp s3://$LAB_S3_BUCKET/lab/manifest.json - \
  --endpoint-url $LAB_S3_ENDPOINT | python -m json.tool
```

### Raw OData Bundles (fast re-sync cache)

**Uploading** new bundles after a sync:
```bash
uv run rating raw-push          # uploads files not already on S3
uv run rating raw-push --dry-run  # preview
```

**Downloading** on a new machine:
```bash
uv run rating raw-pull          # downloads files not already local
uv run rating raw-pull --dry-run  # preview
```

Files are never overwritten in either direction — the commands are safe to run repeatedly.

**S3 layout:**
```
{prefix}/
├── lab.duckdb.gz               # latest DuckDB snapshot
├── manifest.json               # DuckDB stats + watermarks
├── versions/                   # versioned DuckDB backups
│   └── lab.duckdb.{timestamp}.gz
└── ipscresults/
    └── raw/
        └── {match_id}.json.gz  # one file per ipscresults match
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
