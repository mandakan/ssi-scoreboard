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

#### How identity resolution works (detail)

**Phase 1 — Bootstrap SSI** (`_bootstrap_ssi` in `identity.py`)

Every SSI competitor has a stable integer `shooter_id`. This phase:
- Reads all `(shooter_id, name, region)` rows from the `competitors` table
- Groups name variants by `(shooter_id, region)` — a shooter may appear with
  different spellings across matches
- Picks the best primary name (longest non-placeholder, alphabetical tiebreak)
- Writes one `shooter_identities` row per `(shooter_id, region)` pair and one
  `shooter_identity_links` row per name fingerprint (`source='ssi_fp'`)

This creates the lookup table used by Phase 2.

**Phase 2 — Link ipscresults** (`_link_ipscresults` in `identity.py`)

ipscresults competitors have no global ID — they are identified by
`(name, region)` only. For each unlinked competitor:

1. **Name normalisation** — `normalize_name()` converts `"Last, First"` format
   to `"First Last"`. `strip_diacritics()` maps combining marks (ö→o) and
   non-decomposing Nordic characters (Ø→O, Æ→AE, Å→A, ß→ss) to ASCII.
   `name_fingerprint()` lowercases, strips placeholder tokens, and appends the
   region: `"martin hollertz|SWE"`.

2. **Exact match** — the fingerprint is looked up directly in the `ssi_fp` link
   table. If found, the competitor is linked with `confidence=1.0, method='auto_exact'`.

3. **Fuzzy match** — if no exact match, the normalised name is compared against
   all SSI fingerprints in the same region using `difflib.SequenceMatcher`.
   A match is accepted only if **both** of the following hold:
   - **Overall ratio ≥ 0.85** (the threshold at which roughly 2 characters differ
     in a typical 10-character name)
   - **Per-token minimum > 0.75** — the first (given name) and last (family name)
     tokens are compared independently; both must exceed 0.75. This prevents
     false matches where two people share only a first name (`Thomas Larsen` ≠
     `Thomas Olaussen`) or only a last name (`Øyvind Kristiansen` ≠
     `Vidar Kristiansen`) because common Scandinavian suffixes (-ssen, -berg,
     -ström) make the overall ratio misleadingly high. Digit sequences are
     stripped from tokens before this check to handle ipscresults names with
     embedded registration numbers (`Anders1406` → `Anders`).
   - Saved with `confidence=<ratio>, method='auto_fuzzy'`.

4. **New identity** — if no match, a new `canonical_id ≥ 2,000,000` is
   allocated and a new `shooter_identities` row is created.

The fuzzy matching phase runs in parallel across CPU workers (one chunk of
competitors per worker) for speed. Only DB writes are sequential.

**Manual corrections** — `rating link-shooter` creates a `method='manual'`
link that is **never** overwritten by automatic re-resolution. Use it to fix
wrong fuzzy matches.

**Transparency** — the static explorer (`rating export`) includes an **Identity**
tab listing all fuzzy-matched links sorted by confidence ascending. This makes
it easy to spot errors before they affect ratings.

**Known limitations / deferred work**
- Common Scandinavian surnames with shared suffixes (-berg, -ström, -sen) can
  still produce false positives near the 0.75 per-token boundary. The Identity
  tab is the first line of defence.
- `Optics`, `Open Semi-Auto`, `Standard Semi-Auto`, `Standard Manual` divisions
  are intentionally not merged — see `src/data/divisions.py` for full rationale.
- ipscresults name data sometimes contains embedded registration numbers or
  OCR-style digit substitutions (0 for O). Strip logic handles known patterns
  but edge cases may slip through.

**Match deduplication** (`match_dedup.py`)

The same L3+ competition often appears in both SSI and ipscresults. Deduplication:
- Compares match names across sources using `SequenceMatcher` (threshold 0.80)
- Requires dates within ±3 days
- Prefers the richer source (more stages > more competitors > SSI > ipscresults)
- Marks the non-preferred copy with `skip_reason='duplicate'`; it is excluded
  from training automatically via the dedup skip set.
