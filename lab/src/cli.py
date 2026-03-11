"""CLI entry point — typer app with sync, train, benchmark, and serve commands."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import typer
from rich.console import Console

app = typer.Typer(name="rating", help="SSI Scoreboard rating engine CLI")
console = Console()

DB_PATH_OPTION = typer.Option(Path("data/lab.duckdb"), help="Path to DuckDB database")
RAW_DIR_OPTION = typer.Option(
    Path("data/ipscresults-raw"),
    envvar="LAB_RAW_DIR",
    help=(
        "Directory for raw OData bundle cache (one .json.gz per match). "
        "Bundles are loaded before hitting the remote API, making re-syncs instant. "
        "Set to an empty string to disable the file cache."
    ),
)
S3_PREFIX_OPTION = typer.Option(
    "lab", envvar="LAB_S3_PREFIX", help="Key prefix inside the bucket (default: lab)"
)
S3_ENDPOINT_OPTION = typer.Option(
    "",
    envvar="LAB_S3_ENDPOINT",
    help="Endpoint URL — required for Cloudflare R2, omit for AWS S3",
)


def _warn_if_fresh_db(db_path: Path) -> None:
    """Print a hint about db-pull when there is no existing database file.

    A full sync from both sources takes ~1 hour. If a shared bootstrap exists on
    S3/R2, downloading it is much faster — this nudge makes that visible.
    """
    if not db_path.exists():
        console.print(
            f"[yellow]Note:[/yellow] no database found at {db_path}. "
            "A full sync takes ~1 h. If a shared bootstrap is available, "
            "consider running [bold]uv run rating db-pull[/bold] first."
        )


def _date_label(date_from: str | None, date_to: str | None) -> str:
    """Auto-generate a short label from a date range for use as a name suffix.

    Examples::
        (None,         "2025-12-31") → "2025"   # full-year snapshot
        ("2025-01-01", "2025-12-31") → "2025"   # explicit full year
        ("2025-01-01", "2025-06-30") → "2025-01-01_2025-06-30"
        ("2024-01-01", None        ) → "from_2024-01-01"
    """
    if not date_from and not date_to:
        return ""
    if date_to and not date_from:
        return date_to[:4]
    if date_from and date_to:
        full_year = date_from.endswith("-01-01") and date_to.endswith("-12-31")
        if full_year and date_from[:4] == date_to[:4]:
            return date_from[:4]
        return f"{date_from}_{date_to}"
    # date_from only
    return f"from_{date_from}"


def _filter_matches_by_date(
    matches: list[tuple[str, int, str, str | None, str | None]],
    date_from: str | None,
    date_to: str | None,
) -> list[tuple[str, int, str, str | None, str | None]]:
    """Return only matches whose date falls within [date_from, date_to].

    Matches with no date are excluded whenever a date filter is active.
    Both bounds are inclusive (ISO string comparison on the first 10 chars).
    """
    if not date_from and not date_to:
        return matches
    filtered = []
    for m in matches:
        d = m[3]
        if d is None:
            continue
        d10 = d[:10]
        if date_from and d10 < date_from:
            continue
        if date_to and d10 > date_to:
            continue
        filtered.append(m)
    return filtered


def _load_match_ids_file(path: Path) -> set[str]:
    """Load a set of match IDs from a JSON array or newline-separated text file.

    Supported formats:
    - JSON array of strings:  ["uuid1", "uuid2", ...]
    - JSON array of objects:  [{"match_id": "uuid1"}, ...]  (match_id key extracted)
    - Plain text, one match ID per line (blank lines ignored)
    """
    import json as _json

    content = path.read_text().strip()
    if content.startswith("["):
        data = _json.loads(content)
        if data and isinstance(data[0], dict):
            return {str(item["match_id"]) for item in data}
        return {str(item) for item in data}
    return {line.strip() for line in content.splitlines() if line.strip()}


def _train_single_algo(
    algo_name: str,
    db_path: Path,
    matches: list[tuple[str, int, str, str | None, str | None]],
    scoring: str,
    skip_set: set[tuple[str, int, str]],
    suffix: str,
    division_weights: dict[str | None, float] | None = None,
    ics_anchor_match_id: str | None = None,
) -> tuple[
    str,
    dict[
        tuple[int, str | None],
        tuple[str, str | None, str | None, str | None, float, float, int, str | None],
    ],
    int, int, int, float,
]:
    """Train one algorithm in a subprocess with a read-only DB connection.

    Returns (stored_name, rating_data, n_shooters, n_entries, skipped, elapsed_s).
    """
    import time

    from src.algorithms.base import get_algorithms
    from src.data.store import Store

    t0 = time.monotonic()
    algo = get_algorithms(algo_name)[0]
    # For ICS with a pinned anchor, override the default instance.
    if algo_name == "ics" and ics_anchor_match_id is not None:
        from src.algorithms.ics import ICSAlgorithm
        algo = ICSAlgorithm(anchor_match_id=ics_anchor_match_id)
    store = Store(db_path, read_only=True)
    shooter_last_date: dict[int, str] = {}
    skipped = 0
    weights = division_weights or {}

    try:
        for source, ct, match_id, match_date, match_level in matches:
            if (source, ct, match_id) in skip_set:
                skipped += 1
                continue

            if scoring == "stage_hf":
                results = store.get_stage_results_for_match(source, ct, match_id)
                div_map = store.get_competitor_division_map(source, ct, match_id)
            elif scoring == "match_pct_combined":
                pct_scores = store.get_match_scores_pct(source, ct, match_id)
                results = []
                for cid, avg_pct, is_dq, is_zeroed, division in pct_scores:
                    w = weights.get(division, 100.0)
                    normalized = (avg_pct / w * 100.0) if w > 0 else avg_pct
                    results.append((cid, 0, normalized, is_dq, False, is_zeroed))
                div_map = None  # all in one combined group
            else:
                scores = store.get_match_scores(source, ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
                div_map = store.get_competitor_division_map(source, ct, match_id)
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            if not results:
                continue
            algo.process_match_data(
                ct, match_id, match_date, results, comp_map,
                name_map=store.get_competitor_name_map(source, ct, match_id),
                division_map=div_map,
                region_map=store.get_competitor_region_map(source, ct, match_id),
                category_map=store.get_competitor_category_map(source, ct, match_id),
                match_level=match_level,
            )
            if match_date:
                for sid in comp_map.values():
                    if sid is not None:
                        shooter_last_date[sid] = match_date
    finally:
        store.close()

    ratings = algo.get_ratings()
    n_shooters = len({sid for sid, _ in ratings})
    stored_name = f"{algo.name}{suffix}"
    rating_data = {
        (sid, div): (
            r.name, div, r.region, r.category,
            r.mu, r.sigma, r.matches_played,
            shooter_last_date.get(sid),
        )
        for (sid, div), r in ratings.items()
    }
    elapsed = time.monotonic() - t0
    return (stored_name, rating_data, n_shooters, len(ratings), skipped, elapsed)


def _default_workers() -> int:
    """Return a sensible default worker count: CPU cores minus 1, clamped to [1, 8]."""
    import os
    cores = os.cpu_count() or 1
    # Leave one core free for the parent process and system responsiveness.
    return max(1, min(cores - 1, 8))


def _run_train_mode(
    store: Any,
    algorithms: Any,
    matches: list[tuple[str, int, str, str | None, str | None]],
    scoring: str,
    skip_set: set[tuple[str, int, str]] | None = None,
    name_suffix: str = "",
    db_path: Path | None = None,
    workers: int | None = None,
    ics_anchor_match_id: str | None = None,
) -> None:
    """Train all algorithm instances on matches for one scoring mode and save ratings.

    When db_path is provided and there are multiple algorithms, training runs in
    parallel using one subprocess per algorithm (each opens a read-only DuckDB
    connection). Results are batch-written sequentially at the end.

    workers: max number of parallel subprocesses. None = auto (CPU count - 1).
             0 or 1 = force sequential mode.
    """
    import time
    from concurrent.futures import ProcessPoolExecutor, as_completed

    from src.algorithms.base import DivKey
    from src.data.store import RatingRow

    if scoring == "stage_hf":
        suffix = ""
    elif scoring == "match_pct_combined":
        suffix = "_combined"
    else:
        suffix = "_mpct"
    if name_suffix:
        suffix += f"_{name_suffix}"
    skip = skip_set or set()

    # Pre-compute division weights for combined scoring (needs full match list).
    division_weights: dict[str | None, float] | None = None
    if scoring == "match_pct_combined":
        from src.algorithms.base import compute_division_weights

        all_keys = [(s, ct, mid) for s, ct, mid, _d, _l in matches if (s, ct, mid) not in skip]
        pct_by_div = store.get_overall_pct_by_division(all_keys)
        division_weights = compute_division_weights(pct_by_div, percentile=67.0)
        console.print(
            "  Division weights (p=67): "
            + ", ".join(
                f"{d or 'None'}={w:.1f}"
                for d, w in sorted(division_weights.items(), key=lambda x: x[1], reverse=True)
            )
        )

    effective_workers = workers if workers is not None else _default_workers()

    # Parallel path: multiple algorithms, db_path available, workers > 1.
    # DuckDB does not allow concurrent connections while a write lock is held,
    # so close the parent's connection before spawning read-only workers and
    # reopen it afterwards for the batch write phase.
    if db_path is not None and len(algorithms) > 1 and effective_workers > 1:
        algo_names = [a.name for a in algorithms]
        n_workers = min(len(algo_names), effective_workers)
        console.print(f"  [dim]Training {len(algo_names)} algorithms in parallel "
                       f"({n_workers} workers)[/dim]")

        # Release the parent's write lock so workers can open read-only connections.
        store.close()

        results: list[Any] = []
        t_start = time.monotonic()
        try:
            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                futures = {
                    pool.submit(
                        _train_single_algo, name, db_path, matches, scoring, skip, suffix,
                        division_weights, ics_anchor_match_id,
                    ): name
                    for name in algo_names
                }
                for future in as_completed(futures):
                    name = futures[future]
                    result = future.result()
                    results.append(result)
                    console.print(
                        f"  [dim]✓ {name} finished in {result[-1]:.1f}s[/dim]"
                    )
        finally:
            # Reopen the store with write access for batch-writing results
            # and so the caller's `store.close()` in the finally block still works.
            store.__init__(db_path)

        wall_time = time.monotonic() - t_start
        total_cpu = sum(r[-1] for r in results)
        console.print(
            f"\n  [dim]Wall time: {wall_time:.1f}s "
            f"(total CPU: {total_cpu:.1f}s, "
            f"speedup: {total_cpu / wall_time:.1f}×)[/dim]"
        )

        for stored_name, rating_data, n_shooters, n_entries, skipped, _elapsed in results:
            algo_base = stored_name.replace(suffix, "") if suffix else stored_name
            console.print(f"\n[cyan]{algo_base}[/cyan]")
            if skipped:
                console.print(f"  Skipped {skipped} deduplicated matches")
            console.print(
                f"  Rated {n_shooters} shooters ({n_entries} division entries)"
            )
            t_save = time.monotonic()
            store.save_ratings(stored_name, rating_data)
            console.print(
                f"  [green]Saved ratings for {stored_name} "
                f"({time.monotonic() - t_save:.1f}s)[/green]"
            )
        return

    # Sequential fallback: single algorithm or no db_path.
    for algo in algorithms:
        console.print(f"\n[cyan]{algo.name}[/cyan]")
        shooter_last_date: dict[int, str] = {}
        skipped = 0

        for source, ct, match_id, match_date, match_level in matches:
            if (source, ct, match_id) in skip:
                skipped += 1
                continue

            if scoring == "stage_hf":
                results = store.get_stage_results_for_match(source, ct, match_id)
                div_map = store.get_competitor_division_map(source, ct, match_id)
            elif scoring == "match_pct_combined":
                weights = division_weights or {}
                pct_scores = store.get_match_scores_pct(source, ct, match_id)
                results = []
                for cid, avg_pct, is_dq, is_zeroed, division in pct_scores:
                    w = weights.get(division, 100.0)
                    normalized = (avg_pct / w * 100.0) if w > 0 else avg_pct
                    results.append((cid, 0, normalized, is_dq, False, is_zeroed))
                div_map = None  # all in one combined group
            else:
                scores = store.get_match_scores(source, ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
                div_map = store.get_competitor_division_map(source, ct, match_id)
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            if not results:
                continue
            algo.process_match_data(
                ct, match_id, match_date, results, comp_map,
                name_map=store.get_competitor_name_map(source, ct, match_id),
                division_map=div_map,
                region_map=store.get_competitor_region_map(source, ct, match_id),
                category_map=store.get_competitor_category_map(source, ct, match_id),
                match_level=match_level,
            )
            if match_date:
                for sid in comp_map.values():
                    if sid is not None:
                        shooter_last_date[sid] = match_date

        if skipped:
            console.print(f"  Skipped {skipped} deduplicated matches")

        ratings = algo.get_ratings()
        n_shooters = len({sid for sid, _ in ratings})
        console.print(f"  Rated {n_shooters} shooters ({len(ratings)} division entries)")
        stored_name = f"{algo.name}{suffix}"
        rating_data_seq: dict[DivKey, RatingRow] = {
            (sid, div): (
                r.name, div, r.region, r.category,
                r.mu, r.sigma, r.matches_played,
                shooter_last_date.get(sid),
            )
            for (sid, div), r in ratings.items()
        }
        store.save_ratings(stored_name, rating_data_seq)
        console.print(f"  [green]Saved ratings for {stored_name}[/green]")


@app.command()
def sync(
    url: str = typer.Option(
        "https://scoreboard.urdr.dev", help="Base URL of the SSI Scoreboard app"
    ),
    token: str = typer.Option(..., envvar="CACHE_PURGE_SECRET", help="Bearer token for auth"),
    full: bool = typer.Option(False, help="Full sync (ignore watermark)"),
    force: bool = typer.Option(
        False, help="Force re-download of all matches (even if already stored)"
    ),
    delay: float = typer.Option(2.0, help="Delay between requests in seconds (0 for no delay)"),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Sync match data from the SSI Scoreboard app into the local DuckDB store."""
    from src.data.store import Store
    from src.data.sync import SyncClient

    _warn_if_fresh_db(db_path)
    store = Store(db_path)
    jitter = min(delay * 0.5, 1.0) if delay > 0 else 0.0
    client = SyncClient(url, token, store, delay=delay, jitter=jitter)
    try:
        client.sync(full=full, force=force)
    finally:
        client.close()
        store.close()


@app.command(name="sync-ipscresults")
def sync_ipscresults(
    level_min: int = typer.Option(
        3, help="Minimum match level to import (3=National, 4=Continental, 5=World)"
    ),
    disciplines: str = typer.Option(
        "",
        help=(
            "Comma-separated disciplines to import, e.g. 'Handgun,Rifle'. "
            "Leave empty (default) to import all disciplines."
        ),
    ),
    full: bool = typer.Option(False, help="Re-sync all matches, ignoring already-stored ones"),
    raw_only: bool = typer.Option(
        False,
        "--raw-only",
        help=(
            "Download and cache raw bundles only — skip DuckDB writes entirely. "
            "Matches with a local bundle file are skipped automatically, so the "
            "command is safe to stop and restart at any time. "
            "Run without --raw-only afterwards to parse cached bundles into DuckDB."
        ),
    ),
    delay: float = typer.Option(
        0.3, help="Delay between matches in seconds (inter-match only)"
    ),
    raw_dir: Path = RAW_DIR_OPTION,
    bucket: str = typer.Option(
        "",
        envvar="LAB_S3_BUCKET",
        help="S3/R2 bucket for raw bundle storage. Leave empty to use local files only.",
    ),
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Sync match data from ipscresults.org OData API.

    Downloads L3+ (National/Continental/World) match results for all disciplines
    (Handgun, Rifle, Shotgun, …) by default. Use --disciplines to restrict to a
    subset. These complement the SSI dataset which is mostly L2 (Regional).

    Raw OData bundles are cached locally under --raw-dir (default:
    data/ipscresults-raw/).  On re-syncs the bundles are loaded from disk
    instead of the remote API, which is orders of magnitude faster.  If S3
    credentials are available (LAB_S3_BUCKET + AWS_ACCESS_KEY_ID / SECRET), raw
    bundles are also pushed to / pulled from S3 so the cache can be shared
    across machines.

    Run 'rating link' afterwards to resolve shooter identities and remove
    cross-source duplicates before training.
    """
    from src.data.ipscresults import IpscResultsClient, IpscResultsSyncer
    from src.data.raw_store import RawMatchStore
    from src.data.store import Store

    disc_set: set[str] | None = (
        {d.strip() for d in disciplines.split(",") if d.strip()} if disciplines else None
    )
    _warn_if_fresh_db(db_path)
    store = Store(db_path)
    jitter = min(delay * 0.3, 0.1) if delay > 0 else 0.0
    client = IpscResultsClient(delay=delay, jitter=jitter)

    raw_store: RawMatchStore | None = None
    if raw_dir and str(raw_dir):
        s3 = _s3_client(endpoint) if bucket else None
        if bucket:
            _require_boto3()
        raw_store = RawMatchStore(
            raw_dir,
            s3_client=s3,
            s3_bucket=bucket,
            s3_prefix=prefix,
        )

    syncer = IpscResultsSyncer(
        client, store,
        level_min=level_min,
        disciplines=disc_set,
        raw_store=raw_store,
    )
    try:
        syncer.sync(full=full, raw_only=raw_only)
    finally:
        client.close()
        store.close()


@app.command()
def link(
    force: bool = typer.Option(
        False, help="Re-run identity resolution even if links already exist"
    ),
    report: bool = typer.Option(True, help="Print a summary after linking"),
    roster: bool = typer.Option(
        False, help="Also run slower roster-overlap heuristic for match deduplication"
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Resolve cross-source shooter identities and find duplicate matches.

    Run this after syncing data from multiple sources (SSI + ipscresults).
    It is safe to re-run — manual links (from 'rating link-shooter') are never
    overwritten, and already-processed entries are skipped unless --force is used.

    Steps:
      1. Bootstrap SSI shooter_id → canonical_id mapping.
      2. Match ipscresults competitors to SSI identities (exact + fuzzy name matching).
      3. Find matches that appear in both SSI and ipscresults and link them.
    """
    from src.data.identity import IdentityResolver
    from src.data.match_dedup import apply_dedup, find_duplicate_matches
    from src.data.store import Store

    store = Store(db_path)
    try:
        if force:
            console.print(
                "[yellow]--force: clearing all auto-generated identity and dedup links…[/yellow]"
            )
            store.clear_auto_links()

        console.rule("[bold blue]Step 1/2 — Identity resolution[/bold blue]")
        resolver = IdentityResolver()
        resolve_report = resolver.resolve_all(store)
        if report:
            console.print(f"  {resolve_report}")

        console.rule("[bold blue]Step 2/2 — Match deduplication[/bold blue]")
        duplicates = find_duplicate_matches(store, roster=roster)
        apply_dedup(store, duplicates)
        if report:
            total_links = store.get_match_links_count()
            n_new = len(duplicates)
            console.print(f"  Found {n_new} new duplicate pair(s) → {total_links} total links")
            if duplicates:
                for d in duplicates[:10]:  # show first 10
                    console.print(
                        f"  [dim]{d.source_a}[/dim] {d.name_a} ({d.date_a}) ↔ "
                        f"[dim]{d.source_b}[/dim] {d.name_b} ({d.date_b})"
                        f"  conf={d.confidence:.2f}"
                    )
                if len(duplicates) > 10:
                    console.print(f"  … and {len(duplicates) - 10} more")

        console.print("[bold green]Link complete.[/bold green]")
    finally:
        store.close()


@app.command(name="link-shooter")
def link_shooter(
    canonical_id: int = typer.Option(..., help="Target canonical_id to link to"),
    source: str = typer.Option(..., help="Source name: 'ssi' or 'ipscresults'"),
    source_key: str = typer.Option(
        ..., help="Source-specific key: str(shooter_id) for SSI, fingerprint for ipscresults"
    ),
    name_variant: str = typer.Option("", help="Name variant as seen in this source"),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Manually link a source-specific identity to a canonical shooter.

    Manual links are stored with method='manual' and are NEVER overwritten by
    automatic resolution. Use this to fix incorrect fuzzy matches or name changes
    that the resolver cannot handle automatically.

    Examples::

        # Link an ipscresults competitor to SSI shooter 1679
        rating link-shooter --canonical-id 1679 \\
            --source ipscresults \\
            --source-key "marianne hansen|NOR" \\
            --name-variant "Marianne Hansen"

        # Link two SSI entries (e.g. duplicate accounts) to one canonical
        rating link-shooter --canonical-id 40455 --source ssi --source-key 99999
    """
    from src.data.store import Store

    store = Store(db_path)
    try:
        # Verify the canonical_id exists
        row = store.db.execute(
            "SELECT primary_name FROM shooter_identities WHERE canonical_id = ?",
            [canonical_id],
        ).fetchone()
        if row is None:
            console.print(
                f"[red]canonical_id {canonical_id} not found in shooter_identities.[/red]"
            )
            console.print(
                "[dim]Hint: run 'rating link' first to bootstrap SSI identities.[/dim]"
            )
            raise typer.Exit(1)

        store.save_identity_link(
            source=source,
            source_key=source_key,
            canonical_id=canonical_id,
            name_variant=name_variant or source_key,
            confidence=1.0,
            method="manual",
        )
        console.print(
            f"[green]Linked[/green] {source}:{source_key} → canonical_id={canonical_id}"
            f" ({row[0]})"
        )
    finally:
        store.close()


@app.command()
def train(
    algorithm: str = typer.Option(
        "default",
        help=(
            "Which algorithms to train. "
            "'default' = recommended set (openskill_pl_decay, openskill_bt_lvl_decay, "
            "openskill_bt_lvl). "
            "'all' = also includes baselines (openskill, openskill_bt, elo). "
            "Pass a single algorithm name to train just that one."
        ),
    ),
    scoring: str = typer.Option(
        "match_pct",
        help=(
            "Scoring mode: match_pct (whole-match points, default), "
            "stage_hf (per-stage HF), or match_pct_combined (division-weight-normalised "
            "cross-division scoring)."
        ),
    ),
    date_from: str | None = typer.Option(
        None,
        "--date-from",
        help=(
            "Only include matches on or after this date (YYYY-MM-DD). "
            "Use with --date-to for a year window, or alone for a 'from year X' snapshot."
        ),
    ),
    date_to: str | None = typer.Option(
        None,
        "--date-to",
        help=(
            "Only include matches on or before this date (YYYY-MM-DD). "
            "Use alone for an end-of-year snapshot (e.g. --date-to 2025-12-31)."
        ),
    ),
    label: str | None = typer.Option(
        None,
        "--label",
        help=(
            "Override the auto-generated date suffix appended to stored algorithm names "
            "(e.g. --label 2025 stores as 'openskill_2025'). "
            "Auto-generated from --date-from/--date-to when omitted."
        ),
    ),
    workers: int | None = typer.Option(
        None,
        help=(
            "Max parallel worker processes for multi-algorithm training. "
            "Default: CPU cores − 1. Set to 1 for sequential mode."
        ),
    ),
    match_ids_file: Path | None = typer.Option(  # noqa: B008
        None,
        "--match-ids-file",
        help=(
            "Path to a file listing the allowed match IDs. Only matches whose match_id "
            "appears in this file are included in training — all others are skipped. "
            "Supports JSON array of strings ([\"id1\", \"id2\"]) or one ID per line. "
            "Use this to restrict ICS training to the 11 official ICS 2026 ranking matches."
        ),
    ),
    ics_anchor_match_id: str | None = typer.Option(
        None,
        "--ics-anchor-match-id",
        help=(
            "Pin the ICS algorithm's anchor to a single fixed match ID "
            "(e.g. the World Shoot 2025 match_id from the database). "
            "When set, the anchor is frozen after that match is processed; "
            "subsequent L4/L5 events use the fixed reference pool instead of "
            "refreshing the anchor. Faithfully reproduces official ICS 2.0 behaviour. "
            "Has no effect on non-ICS algorithms."
        ),
    ),
    discipline: str | None = typer.Option(
        None,
        "--discipline",
        help=(
            "Comma-separated discipline filter, e.g. 'Handgun' or 'Handgun,PCC'. "
            "Only matches whose discipline matches one of the values are included. "
            "Leave empty (default) to train on all disciplines."
        ),
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Train rating algorithms on synced match data.

    Two scoring modes are available:

    stage_hf  — each stage is an independent ranking event (default).
                A 10-stage match gives 10 data points; more signal, faster convergence.

    match_pct — the whole match is one ranking event, ordered by total match points.
                Aligns with IPSC's official scoring. Ratings are stored with a _mpct
                suffix so both modes can coexist and be compared in the explorer.

    Use --date-to for end-of-year snapshots ("best through 2025") or combine
    --date-from and --date-to for a pure year window ("best of 2025 only"):

        # End-of-2025 snapshot — all history up to 2025-12-31
        rating train --date-to 2025-12-31
        # → stored as openskill_2025, openskill_mpct_2025, etc.

        # 2025-only window — only matches from 2025
        rating train --date-from 2025-01-01 --date-to 2025-12-31
        # → same suffix (full-year detected automatically)

    To train a faithful ICS 2026 model (Gap 1–3 from the ICS 2.0 spec):

        rating train --algorithm ics --scoring match_pct \\
          --date-from 2024-10-01 --date-to 2026-06-30 \\
          --ics-anchor-match-id <ws2025_match_id> \\
          --match-ids-file data/ics2026_match_ids.txt \\
          --label ics2026
        # → stored as ics_mpct_ics2026

    Tip: run 'rating link' before training to resolve cross-source shooter identities
    and exclude duplicate matches from the training set.
    """
    from src.algorithms.base import get_algorithms
    from src.data.store import Store

    if scoring not in ("stage_hf", "match_pct", "match_pct_combined"):
        console.print(
            f"[red]Unknown scoring mode '{scoring}'. "
            "Use stage_hf, match_pct, or match_pct_combined.[/red]"
        )
        raise typer.Exit(1)

    name_suffix = label if label is not None else _date_label(date_from, date_to)

    store = Store(db_path)
    try:
        algorithms = get_algorithms("all") if algorithm == "all" else get_algorithms(algorithm)
        # ICS handles division weighting internally — running it with
        # match_pct_combined would double-normalise scores. Exclude it.
        if scoring == "match_pct_combined":
            algorithms = [a for a in algorithms if a.name != "ics"]
        # For ICS with a pinned anchor, replace the default ICS instance so
        # the sequential training path also gets the correct anchor_match_id.
        if ics_anchor_match_id is not None and scoring != "match_pct_combined":
            from src.algorithms.ics import ICSAlgorithm
            algorithms = [
                ICSAlgorithm(anchor_match_id=ics_anchor_match_id)
                if a.name == "ics" else a
                for a in algorithms
            ]
        disc_set: set[str] | None = (
            {d.strip() for d in discipline.split(",") if d.strip()} if discipline else None
        )
        all_matches = store.get_matches_chronological(disciplines=disc_set)
        matches = _filter_matches_by_date(all_matches, date_from, date_to)
        # Apply curated match-ID filter when provided (Gap 3 — ICS 2026 specific list).
        if match_ids_file is not None:
            allowed_ids = _load_match_ids_file(match_ids_file)
            before = len(matches)
            matches = [m for m in matches if m[2] in allowed_ids]
            console.print(
                f"  [dim]Match-ID filter: {len(allowed_ids)} allowed IDs → "
                f"{len(matches)} matches (was {before})[/dim]"
            )
        skip_set = store.get_dedup_skip_set()
        n_algo, n_match = len(algorithms), len(matches)
        _mode_labels = {
            "stage_hf": "stage HF", "match_pct": "match %", "match_pct_combined": "combined %"
        }
        mode_label = _mode_labels.get(scoring, scoring)

        date_range = ""
        if date_from or date_to:
            date_range = f", window: {date_from or '*'} → {date_to or '*'}"
        console.print(
            f"[bold]Training {n_algo} algorithm(s) on {n_match} matches "
            f"(scoring: {mode_label}, dedup skip: {len(skip_set)}{date_range})[/bold]"
        )
        if name_suffix:
            console.print(f"  Storing as: [cyan]<algo>_{name_suffix}[/cyan]")
        if ics_anchor_match_id:
            console.print(f"  ICS anchor pinned to: [cyan]{ics_anchor_match_id}[/cyan]")

        _run_train_mode(
            store, algorithms, matches, scoring,
            skip_set=skip_set, name_suffix=name_suffix,
            db_path=db_path, workers=workers,
            ics_anchor_match_id=ics_anchor_match_id,
        )
    finally:
        store.close()


@app.command()
def benchmark(
    split: float = typer.Option(0.7, help="Train/test split ratio (chronological)"),
    chart: bool = typer.Option(False, help="Save a comparison chart to data/benchmark.png"),
    scoring: str = typer.Option(
        "match_pct",
        help="Scoring mode: match_pct (default), stage_hf, or all (runs both, combined table)",
    ),
    discipline: str | None = typer.Option(
        None,
        "--discipline",
        help=(
            "Comma-separated discipline filter, e.g. 'Handgun' or 'Handgun,PCC'. "
            "Only matches whose discipline matches one of the values are included. "
            "Leave empty (default) to benchmark on all disciplines."
        ),
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Run benchmark comparing all algorithms (base + conservative ranking variants).

    Use --scoring all to run both stage_hf and match_pct in one pass and compare
    them side-by-side in a single table — the clearest way to see which scoring
    mode performs better for your data.
    """
    from src.benchmark.report import save_chart
    from src.benchmark.runner import run_benchmark
    from src.data.store import Store

    disc_set: set[str] | None = (
        {d.strip() for d in discipline.split(",") if d.strip()} if discipline else None
    )
    store = Store(db_path)
    try:
        algo_metrics = run_benchmark(
            store, split_ratio=split, scoring=scoring, disciplines=disc_set
        )
        if chart and algo_metrics:
            save_chart(algo_metrics, output_path=str(db_path.parent / "benchmark.png"))
    finally:
        store.close()


@app.command()
def tune(
    scoring: str = typer.Option(
        "match_pct",
        help="Scoring mode: match_pct, stage_hf, or match_pct_combined",
    ),
    split: float = typer.Option(0.7, help="Train/test split ratio"),
    workers: int | None = typer.Option(None, help="Max parallel workers (default: CPU-1)"),
    output: Path | None = typer.Option(  # noqa: B008
        None,
        help=(
            "Output JSON path. Defaults to data/tune_results_{scoring}.json "
            "so runs for different scoring modes don't overwrite each other."
        ),
    ),
    discipline: str | None = typer.Option(
        None,
        "--discipline",
        help=(
            "Comma-separated discipline filter, e.g. 'Handgun' or 'Handgun,PCC'. "
            "Only matches whose discipline matches one of the values are included. "
            "Leave empty (default) to sweep on all disciplines."
        ),
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Run automated hyperparameter grid search.

    Evaluates all algorithm x parameter combinations using a chronological
    train/test split. Results are saved to data/tune_results_{scoring}.json
    (one file per scoring mode) and printed as a ranked table.

    To distribute across machines, copy the same DuckDB to each machine, run
    one scoring mode per machine, then combine with: rating tune-merge
    """
    from src.tuning.sweep import run_sweep

    disc_set: set[str] | None = (
        {d.strip() for d in discipline.split(",") if d.strip()} if discipline else None
    )
    _warn_if_fresh_db(db_path)
    run_sweep(
        db_path=db_path,
        scoring=scoring,
        split_ratio=split,
        workers=workers,
        output_path=output,
        disciplines=disc_set,
    )


@app.command("tune-merge")
def tune_merge(
    files: list[Path] = typer.Argument(  # noqa: B008
        None,
        help=(
            "tune_results JSON files to merge. "
            "Defaults to all data/tune_results_*.json files."
        ),
    ),
    top: int = typer.Option(30, help="Number of rows to show in the merged table"),  # noqa: B008
) -> None:
    """Combine and display results from multiple tuning runs.

    Useful when sweeps are distributed across machines (one per scoring mode)
    or run at different times. Each result is uniquely keyed by (label, scoring)
    — if the same config appears in multiple files the last file wins.

    Examples:

        # After running all three scoring modes:
        rating tune-merge

        # From files on different machines, copied locally:
        rating tune-merge results_match_pct.json results_stage_hf.json results_combined.json
    """
    from src.tuning.sweep import merge_results

    if not files:
        # Auto-discover all tune_results_*.json files in data/
        discovered = sorted(Path("data").glob("tune_results_*.json"))
        if not discovered:
            console.print(
                "[red]No tune_results_*.json files found in data/. "
                "Run 'rating tune' first or pass file paths explicitly.[/red]"
            )
            raise typer.Exit(1)
        console.print(f"[dim]Auto-discovered {len(discovered)} file(s):[/dim]")
        for p in discovered:
            console.print(f"  [dim]{p}[/dim]")
        files = discovered

    merge_results(list(files), top_n=top)


@app.command(name="clear-ratings")
def clear_ratings(
    algorithm: list[str] = typer.Argument(
        None,
        help=(
            "Algorithm name(s) to delete from shooter_ratings and rating_history. "
            "Omit to list all stored algorithms without deleting anything."
        ),
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """List or delete stored model output from DuckDB.

    Without arguments, lists all algorithm names currently in shooter_ratings.

    With one or more algorithm names, deletes their rows from shooter_ratings
    and rating_history (irreversible — re-run 'rating train' to regenerate).

    Examples:

        rating clear-ratings                         # list stored algorithms
        rating clear-ratings openskill_2024          # delete one
        rating clear-ratings openskill elo           # delete multiple
    """
    from src.data.store import Store

    store = Store(db_path)
    try:
        stored = store.list_algorithms()
        if not algorithm:
            if not stored:
                console.print("[yellow]No algorithms stored in shooter_ratings.[/yellow]")
            else:
                console.print("[bold]Stored algorithms:[/bold]")
                for name in stored:
                    console.print(f"  {name}")
            return

        unknown = [a for a in algorithm if a not in stored]
        if unknown:
            console.print(
                f"[yellow]Unknown algorithm(s): {', '.join(unknown)}[/yellow]\n"
                f"Stored: {', '.join(stored) if stored else '(none)'}"
            )
            raise typer.Exit(1)

        for name in algorithm:
            n = store.drop_ratings(name)
            console.print(f"[green]Deleted[/green] {name} ({n} rows)")
    finally:
        store.close()


@app.command()
def export(
    output_dir: Path = typer.Option(Path("site"), help="Output directory for the static explorer"),  # noqa: B008
    ssi_only: bool = typer.Option(
        True,
        "--ssi-only/--include-ipscresults",
        help=(
            "SSI-only mode (default): exclude shooters who have no SSI registration "
            "(canonical_id >= 2,000,000). Their match data still calibrates SSI shooters' "
            "ratings but their names are not published. Use --include-ipscresults for "
            "internal or research use only."
        ),
    ),
    algorithms: str | None = typer.Option(
        None,
        "--algorithms",
        help=(
            "Comma-separated list of algorithm names to include in the export. "
            "Omit to export all stored algorithms. "
            "Example: --algorithms openskill_pl_decay,openskill_bt_lvl_decay"
        ),
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Export ratings to a self-contained static HTML explorer.

    The generated site/ directory can be:
    - Opened directly in a browser (open site/index.html)
    - Served by the rating engine (mounts automatically when site/ exists)
    - Deployed to GitHub Pages (commit site/, rename to docs/, enable Pages from /docs)
    - Deployed to Cloudflare Pages (set publish directory to lab/site)
    """
    from src.data.exporter import export_data
    from src.data.store import Store
    from src.engine.page import generate_site

    algo_set: set[str] | None = (
        {a.strip() for a in algorithms.split(",") if a.strip()} if algorithms else None
    )

    store = Store(db_path)
    try:
        data = export_data(store, ssi_only=ssi_only, algorithms=algo_set)
        generate_site(data, output_dir, data_dir=db_path.parent)
        console.print(f"\n[bold]Open locally:[/bold] {output_dir / 'index.html'}")
        console.print(
            "[dim]Tip: commit site/ and push — "
            "the rating server mounts it automatically at /.[/dim]"
        )
    finally:
        store.close()


@app.command()
def pipeline(
    url: str = typer.Option(
        "https://scoreboard.urdr.dev", help="Base URL of the SSI Scoreboard app"
    ),
    token: str = typer.Option(..., envvar="CACHE_PURGE_SECRET", help="Bearer token for auth"),
    full: bool = typer.Option(False, help="Full sync (ignore watermark)"),
    force: bool = typer.Option(False, help="Force re-download of all matches"),
    delay: float = typer.Option(2.0, help="Delay between requests in seconds"),
    skip_ipscresults: bool = typer.Option(
        False, help="Skip ipscresults.org sync (useful when already synced)"
    ),
    ssi_only: bool = typer.Option(
        True,
        "--ssi-only/--include-ipscresults",
        help=(
            "SSI-only mode (default): exclude shooters with no SSI registration from "
            "the published site. Use --include-ipscresults for internal/research use only."
        ),
    ),
    output_dir: Path = typer.Option(Path("site"), help="Output directory for the static explorer"),  # noqa: B008
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Run the full pipeline: sync → sync-ipscresults → link → train → export.

    Equivalent to running sync, sync-ipscresults, link, train --scoring stage_hf,
    train --scoring match_pct, and export in sequence. Both scoring modes are trained
    so the exported explorer lets you switch between them without re-running anything.
    """
    from src.algorithms.base import get_algorithms
    from src.data.exporter import export_data
    from src.data.identity import IdentityResolver
    from src.data.ipscresults import IpscResultsClient, IpscResultsSyncer
    from src.data.match_dedup import apply_dedup, find_duplicate_matches
    from src.data.store import Store
    from src.data.sync import SyncClient
    from src.engine.page import generate_site

    store = Store(db_path)
    try:
        console.rule("[bold blue]Step 1/5 — Sync SSI[/bold blue]")
        jitter = min(delay * 0.5, 1.0) if delay > 0 else 0.0
        client = SyncClient(url, token, store, delay=delay, jitter=jitter)
        try:
            client.sync(full=full, force=force)
        finally:
            client.close()

        if not skip_ipscresults:
            console.rule("[bold blue]Step 2/5 — Sync ipscresults[/bold blue]")
            ir_client = IpscResultsClient(delay=0.3, jitter=0.1)
            syncer = IpscResultsSyncer(ir_client, store)  # disciplines=None → all
            try:
                syncer.sync(full=full)
            finally:
                ir_client.close()
        else:
            console.print("[dim]Skipping ipscresults sync (--skip-ipscresults)[/dim]")

        console.rule("[bold blue]Step 3/5 — Link identities & deduplicate[/bold blue]")
        resolver = IdentityResolver()
        resolve_report = resolver.resolve_all(store)
        console.print(f"  Identity: {resolve_report}")
        duplicates = find_duplicate_matches(store)
        apply_dedup(store, duplicates)
        console.print(f"  Dedup: {len(duplicates)} new duplicate link(s)")

        matches = store.get_matches_chronological()
        skip_set = store.get_dedup_skip_set()
        console.rule("[bold blue]Step 4/5 — Train (match %)[/bold blue]")
        console.print(
            f"  {len(matches)} matches · {len(skip_set)} skipped (dedup)"
            " · scoring: match %"
        )
        _run_train_mode(
            store, get_algorithms(), matches, "match_pct",
            skip_set=skip_set, db_path=db_path,
        )

        console.rule("[bold blue]Step 5/5 — Export[/bold blue]")
        data = export_data(store, ssi_only=ssi_only)
        generate_site(data, output_dir, data_dir=db_path.parent)
        console.print("\n[bold green]Pipeline complete![/bold green]")
    finally:
        store.close()


def _require_boto3() -> None:
    """Print a helpful error and exit if boto3 is not installed."""
    try:
        import boto3  # noqa: F401
    except ImportError as exc:
        console.print(
            "[red]boto3 not installed.[/red] "
            "Run: [bold]uv sync --extra storage[/bold]"
        )
        raise typer.Exit(1) from exc


def _s3_client(endpoint: str) -> Any:
    """Return a configured boto3 S3 client."""
    import boto3
    kwargs: dict[str, str] = {}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
        # Cloudflare R2 uses its own region names — "auto" is the safe default.
        # Without this, boto3 picks up the AWS region from ~/.aws/config which
        # R2 rejects as invalid.
        kwargs["region_name"] = "auto"
    return boto3.client("s3", **kwargs)  # type: ignore[no-untyped-call]


def _read_db_stats(db_path: Path) -> dict[str, Any]:
    """Return match count, watermarks and schema version from a local DuckDB."""
    from src.data.store import SCHEMA_VERSION, Store

    store = Store(db_path)
    try:
        row = store.db.execute("SELECT count(*) FROM matches").fetchone()
        return {
            "match_count": int(row[0]) if row else 0,
            "ssi_watermark": store.get_sync_watermark(source="ssi"),
            "ipscresults_watermark": store.get_sync_watermark(source="ipscresults"),
            "schema_version": SCHEMA_VERSION,
        }
    finally:
        store.close()


def _local_is_newer(local: dict[str, Any], remote: dict[str, Any]) -> bool:
    """Return True if local DB appears to have more or newer data than the remote manifest."""
    lc = local.get("match_count") or 0
    rc = remote.get("match_count") or 0
    if lc > rc:
        return True
    if lc == rc:
        # Same number of matches — check watermarks.
        ls = local.get("ssi_watermark") or ""
        rs = remote.get("ssi_watermark") or ""
        li = local.get("ipscresults_watermark") or ""
        ri = remote.get("ipscresults_watermark") or ""
        return ls > rs or li > ri
    return False


_DB_KEY = "lab.duckdb.gz"
_MANIFEST_KEY = "manifest.json"


def _prune_versions(s3: Any, bucket: str, prefix: str, max_versions: int) -> None:
    """Delete old versioned backups beyond max_versions, keeping the newest ones.

    Versions live at {prefix}/versions/lab.duckdb.YYYYMMDDTHHMMSS.gz.
    Sorting by key name is equivalent to sorting by upload time (ISO timestamp).
    """
    versions_prefix = f"{prefix}/versions/"
    paginator = s3.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=versions_prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])

    keys.sort()  # oldest first (lexicographic = chronological for ISO timestamps)
    to_delete = keys[:-max_versions] if len(keys) > max_versions else []
    if to_delete:
        s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": k} for k in to_delete]},
        )
        console.print(f"  Pruned {len(to_delete)} old version(s) (kept {max_versions})")

S3_BUCKET_OPTION = typer.Option(..., envvar="LAB_S3_BUCKET", help="S3/R2 bucket name")


@app.command(name="db-push")
def db_push(
    db_path: Path = DB_PATH_OPTION,
    bucket: str = S3_BUCKET_OPTION,
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
    max_versions: int = typer.Option(
        10, help="Number of versioned backups to keep in S3 (0 to disable versioning)"
    ),
) -> None:
    """Compress and upload the local DuckDB to S3/R2 as a shared bootstrap.

    Checks the remote manifest first — if the remote DB appears newer than
    the local one, a confirmation prompt is shown (bypass with --yes).

    Also saves a versioned copy under {prefix}/versions/ and prunes old
    versions beyond --max-versions (default 10), providing a rolling backup.

    Required env vars: LAB_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    For Cloudflare R2: also set LAB_S3_ENDPOINT to your R2 endpoint URL.

    Example (R2)::

        export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
        export LAB_S3_BUCKET=my-lab-bucket
        export AWS_ACCESS_KEY_ID=...
        export AWS_SECRET_ACCESS_KEY=...
        uv run rating db-push
    """
    import gzip
    import json
    import shutil
    import tempfile
    from datetime import UTC, datetime

    from botocore.exceptions import ClientError

    _require_boto3()

    if not db_path.exists():
        console.print(f"[red]DB not found:[/red] {db_path}")
        raise typer.Exit(1)

    console.print("[bold]Reading local DB stats...[/bold]")
    stats = _read_db_stats(db_path)
    console.print(
        f"  {stats['match_count']} matches | "
        f"SSI: {stats['ssi_watermark']} | "
        f"ipscresults: {stats['ipscresults_watermark']}"
    )

    db_key = f"{prefix}/{_DB_KEY}"
    manifest_key = f"{prefix}/{_MANIFEST_KEY}"
    s3 = _s3_client(endpoint)

    # Safety check: warn if the remote DB appears newer than local.
    console.print("[bold]Checking remote manifest...[/bold]")
    try:
        resp = s3.get_object(Bucket=bucket, Key=manifest_key)
        remote: dict[str, Any] = json.loads(resp["Body"].read())
        console.print(
            f"  Remote: {remote.get('match_count', '?')} matches | "
            f"SSI: {remote.get('ssi_watermark')} | "
            f"ipscresults: {remote.get('ipscresults_watermark')} | "
            f"uploaded: {str(remote.get('uploaded_at', '?'))[:10]}"
        )
        if _local_is_newer(remote, stats):
            console.print(
                "[bold yellow]Warning:[/bold yellow] "
                "the remote DB appears to have more or newer data than your local copy."
            )
            if not yes and not typer.confirm("Overwrite remote DB anyway?", default=False):
                console.print("[dim]Aborted.[/dim]")
                raise typer.Exit(0)
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            console.print("  No existing remote manifest — first push.")
        else:
            console.print(f"[yellow]Warning: could not fetch remote manifest: {e}[/yellow]")

    original_bytes = db_path.stat().st_size
    now_ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")

    console.print(
        f"[bold]Compressing {db_path.name} "
        f"({original_bytes / 1_048_576:.1f} MB)...[/bold]"
    )
    tmp_gz_fd, tmp_gz_str = tempfile.mkstemp(suffix=".duckdb.gz", dir=db_path.parent)
    os.close(tmp_gz_fd)
    tmp_gz = Path(tmp_gz_str)
    try:
        with open(db_path, "rb") as src, gzip.open(tmp_gz, "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst)
        compressed_bytes = tmp_gz.stat().st_size
        ratio = compressed_bytes / original_bytes * 100
        console.print(
            f"  Compressed to {compressed_bytes / 1_048_576:.1f} MB ({ratio:.0f}%)"
        )

        # Upload the latest copy.
        console.print(f"[bold]Uploading to s3://{bucket}/{db_key}...[/bold]")
        s3.upload_file(str(tmp_gz), bucket, db_key)

        # Upload a versioned copy.
        if max_versions > 0:
            version_key = f"{prefix}/versions/lab.duckdb.{now_ts}.gz"
            console.print(f"  Versioned copy → s3://{bucket}/{version_key}")
            s3.upload_file(str(tmp_gz), bucket, version_key)
            _prune_versions(s3, bucket, prefix, max_versions)

        manifest: dict[str, Any] = {
            **stats,
            "uploaded_at": datetime.now(UTC).isoformat(),
            "db_key": db_key,
            "original_size_bytes": original_bytes,
            "compressed_size_bytes": compressed_bytes,
        }
        s3.put_object(
            Bucket=bucket,
            Key=manifest_key,
            Body=json.dumps(manifest, indent=2).encode(),
            ContentType="application/json",
        )
        console.print(f"  Manifest written to s3://{bucket}/{manifest_key}")

    finally:
        tmp_gz.unlink(missing_ok=True)

    console.print(
        f"[bold green]Done.[/bold green] "
        f"{stats['match_count']} matches, "
        f"{compressed_bytes / 1_048_576:.1f} MB uploaded."
    )


@app.command(name="db-versions")
def db_versions(
    bucket: str = S3_BUCKET_OPTION,
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
) -> None:
    """List available versioned backups stored in S3/R2.

    Shows each version's timestamp, size, and the version ID to pass to
    'rating db-pull --version <id>' for restoration.
    """
    _require_boto3()

    s3 = _s3_client(endpoint)
    versions_prefix = f"{prefix}/versions/"
    paginator = s3.get_paginator("list_objects_v2")

    entries: list[tuple[str, int, str]] = []  # (key, size_bytes, version_id)
    for page in paginator.paginate(Bucket=bucket, Prefix=versions_prefix):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            size: int = obj["Size"]
            # Extract timestamp from e.g. "lab/versions/lab.duckdb.20250307T142301.gz"
            fname = key.split("/")[-1]  # lab.duckdb.20250307T142301.gz
            version_id = fname.removeprefix("lab.duckdb.").removesuffix(".gz")
            entries.append((key, size, version_id))

    if not entries:
        console.print("[yellow]No versioned backups found.[/yellow]")
        console.print(
            "[dim]Run 'rating db-push' (with --max-versions > 0) to create versioned backups.[/dim]"
        )
        return

    entries.sort(reverse=True)  # newest first
    console.print(f"[bold]{len(entries)} versioned backup(s) in s3://{bucket}/{versions_prefix}[/bold]")
    console.print()
    for _key, size, version_id in entries:
        # Parse timestamp for human display: 20250307T142301 → 2025-03-07 14:23:01
        ts = version_id
        if len(ts) == 15 and "T" in ts:
            ts = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]} {ts[9:11]}:{ts[11:13]}:{ts[13:15]}"
        console.print(
            f"  [cyan]{version_id}[/cyan]  {ts}  {size / 1_048_576:.1f} MB"
        )

    console.print()
    console.print("[dim]Restore with: rating db-pull --version <id>[/dim]")


@app.command(name="db-pull")
def db_pull(
    db_path: Path = DB_PATH_OPTION,
    bucket: str = S3_BUCKET_OPTION,
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
    yes: bool = typer.Option(False, "--yes", "-y", help="Skip confirmation prompt"),
    version: str | None = typer.Option(
        None,
        "--version",
        help=(
            "Restore a specific version instead of the latest. "
            "Use 'rating db-versions' to list available version IDs."
        ),
    ),
) -> None:
    """Download the latest bootstrap DuckDB from S3/R2.

    Pass --version <id> (from 'rating db-versions') to restore a specific
    earlier backup instead of the current latest.

    Compares the remote manifest against the local DB before downloading.
    If the local DB appears to have more or newer data, you will be asked to
    confirm before it is overwritten (bypass with --yes).

    Required env vars: LAB_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    For Cloudflare R2: also set LAB_S3_ENDPOINT to your R2 endpoint URL.

    Example (R2)::

        export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
        export LAB_S3_BUCKET=my-lab-bucket
        export AWS_ACCESS_KEY_ID=...
        export AWS_SECRET_ACCESS_KEY=...
        uv run rating db-pull
        uv run rating db-pull --version 20250307T142301
    """
    import gzip
    import json
    import os
    import shutil
    import tempfile

    from botocore.exceptions import ClientError

    _require_boto3()

    s3 = _s3_client(endpoint)

    if version:
        # Versioned restore: skip the manifest, download directly from versions/.
        db_key = f"{prefix}/versions/lab.duckdb.{version}.gz"
        console.print(f"[bold]Restoring version {version}[/bold]")
        console.print(f"  Source: s3://{bucket}/{db_key}")
        display_info: dict[str, Any] = {"match_count": "?"}
    else:
        # Latest restore: read manifest for metadata and safety comparison.
        db_key = f"{prefix}/{_DB_KEY}"
        manifest_key = f"{prefix}/{_MANIFEST_KEY}"

        console.print("[bold]Fetching remote manifest...[/bold]")
        try:
            resp = s3.get_object(Bucket=bucket, Key=manifest_key)
            display_info = json.loads(resp["Body"].read())
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("NoSuchKey", "404"):
                console.print("[red]No manifest found — has db-push been run yet?[/red]")
            else:
                console.print(f"[red]Failed to fetch manifest: {e}[/red]")
            raise typer.Exit(1) from e

        console.print(
            f"  Remote: {display_info.get('match_count', '?')} matches | "
            f"SSI: {display_info.get('ssi_watermark')} | "
            f"ipscresults: {display_info.get('ipscresults_watermark')} | "
            f"uploaded: {str(display_info.get('uploaded_at', '?'))[:10]}"
        )

    # Safety check: warn if local DB exists and appears newer.
    if db_path.exists():
        console.print("[bold]Reading local DB stats...[/bold]")
        local = _read_db_stats(db_path)
        console.print(
            f"  Local:  {local['match_count']} matches | "
            f"SSI: {local['ssi_watermark']} | "
            f"ipscresults: {local['ipscresults_watermark']}"
        )
        if _local_is_newer(local, display_info):
            msg = (
                f"local DB appears to have more or newer data than the "
                f"{'selected version' if version else 'remote bootstrap'}."
            )
            console.print(f"[bold yellow]Warning:[/bold yellow] {msg}")
            if not yes and not typer.confirm("Overwrite local DB anyway?", default=False):
                console.print("[dim]Aborted.[/dim]")
                raise typer.Exit(0)

    # Download to a temp file, then atomically replace.
    compressed_mb = display_info.get("compressed_size_bytes", 0) / 1_048_576
    size_str = f" ({compressed_mb:.1f} MB)" if compressed_mb else ""
    console.print(f"[bold]Downloading s3://{bucket}/{db_key}{size_str}...[/bold]")
    tmp_gz_fd, tmp_gz_str = tempfile.mkstemp(suffix=".duckdb.gz", dir=db_path.parent)
    os.close(tmp_gz_fd)
    tmp_gz = Path(tmp_gz_str)
    tmp_db_fd, tmp_db_str = tempfile.mkstemp(suffix=".duckdb.tmp", dir=db_path.parent)
    os.close(tmp_db_fd)
    tmp_db = Path(tmp_db_str)
    try:
        try:
            s3.download_file(bucket, db_key, str(tmp_gz))
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                console.print(f"[red]Version '{version}' not found in S3.[/red]")
                console.print("[dim]Run 'rating db-versions' to see available versions.[/dim]")
                raise typer.Exit(1) from e
            raise

        console.print("[bold]Decompressing...[/bold]")
        with gzip.open(tmp_gz, "rb") as src, open(tmp_db, "wb") as dst:
            shutil.copyfileobj(src, dst)

        db_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(tmp_db, db_path)  # atomic on POSIX
    finally:
        tmp_gz.unlink(missing_ok=True)
        tmp_db.unlink(missing_ok=True)

    final_mb = db_path.stat().st_size / 1_048_576
    console.print(
        f"[bold green]Done.[/bold green] "
        f"{display_info.get('match_count', '?')} matches, "
        f"{final_mb:.1f} MB at {db_path}"
    )


# ---------------------------------------------------------------------------
# raw-push / raw-pull — sync raw OData bundle files with S3/R2
# ---------------------------------------------------------------------------

@app.command(name="raw-push")
def raw_push(
    raw_dir: Path = RAW_DIR_OPTION,
    bucket: str = S3_BUCKET_OPTION,
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
    dry_run: bool = typer.Option(
        False, "--dry-run", help="List what would be uploaded without doing it"
    ),
) -> None:
    """Upload local raw OData bundle files to S3/R2.

    Uploads only files that are not already present in S3 (content-addressed
    by filename — each match has a stable UUID-based name). Existing remote
    files are never overwritten, so it is safe to run repeatedly.

    Required env vars: LAB_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    For Cloudflare R2: also set LAB_S3_ENDPOINT to your R2 endpoint URL.

    Example (R2)::

        export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
        export LAB_S3_BUCKET=my-lab-bucket
        uv run rating raw-push
        uv run rating raw-push --dry-run
    """
    _require_boto3()

    if not raw_dir.exists():
        console.print(f"[yellow]Raw dir not found:[/yellow] {raw_dir}")
        raise typer.Exit(0)

    local_files = sorted(raw_dir.glob("*.json.gz"))
    if not local_files:
        console.print(f"[yellow]No bundle files in {raw_dir}[/yellow]")
        raise typer.Exit(0)

    s3 = _s3_client(endpoint)
    s3_prefix = f"{prefix}/ipscresults/raw"

    # Build set of filenames already on S3.
    console.print(f"[bold]Scanning s3://{bucket}/{s3_prefix}/...[/bold]")
    remote_names: set[str] = set()
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=s3_prefix + "/"):
        for obj in page.get("Contents", []):
            remote_names.add(obj["Key"].split("/")[-1])

    to_upload = [f for f in local_files if f.name not in remote_names]

    total_local = len(local_files)
    already = total_local - len(to_upload)
    console.print(
        f"  {total_local} local files | {already} already on S3 | {len(to_upload)} to upload"
    )

    if not to_upload:
        console.print("[bold green]Nothing to upload — S3 is up to date.[/bold green]")
        raise typer.Exit(0)

    if dry_run:
        console.print("[dim]--dry-run: would upload:[/dim]")
        for f in to_upload:
            console.print(f"  {f.name}")
        raise typer.Exit(0)

    console.print(f"[bold]Uploading {len(to_upload)} file(s)...[/bold]")
    uploaded = 0
    failed = 0
    for local in to_upload:
        key = f"{s3_prefix}/{local.name}"
        try:
            s3.upload_file(str(local), bucket, key)
            uploaded += 1
            if uploaded % 50 == 0 or uploaded == len(to_upload):
                console.print(f"  {uploaded}/{len(to_upload)} uploaded")
        except Exception as exc:  # noqa: BLE001
            console.print(f"  [red]Failed:[/red] {local.name} — {exc}")
            failed += 1

    if failed:
        console.print(
            f"[bold yellow]Done with {failed} error(s). {uploaded} uploaded.[/bold yellow]"
        )
        raise typer.Exit(1)

    console.print(f"[bold green]Done.[/bold green] {uploaded} file(s) uploaded.")


@app.command(name="raw-pull")
def raw_pull(
    raw_dir: Path = RAW_DIR_OPTION,
    bucket: str = S3_BUCKET_OPTION,
    prefix: str = S3_PREFIX_OPTION,
    endpoint: str = S3_ENDPOINT_OPTION,
    dry_run: bool = typer.Option(
        False, "--dry-run", help="List what would be downloaded without doing it"
    ),
) -> None:
    """Download raw OData bundle files from S3/R2 that are missing locally.

    Downloads only files not already present in the local raw dir.
    Existing local files are never overwritten.

    Required env vars: LAB_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
    For Cloudflare R2: also set LAB_S3_ENDPOINT to your R2 endpoint URL.

    Example (R2)::

        export LAB_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
        export LAB_S3_BUCKET=my-lab-bucket
        uv run rating raw-pull
        uv run rating raw-pull --dry-run
    """
    _require_boto3()

    raw_dir.mkdir(parents=True, exist_ok=True)
    s3 = _s3_client(endpoint)
    s3_prefix = f"{prefix}/ipscresults/raw"

    console.print(f"[bold]Scanning s3://{bucket}/{s3_prefix}/...[/bold]")
    remote_files: list[tuple[str, str]] = []  # (key, filename)
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=s3_prefix + "/"):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            name = key.split("/")[-1]
            if name.endswith(".json.gz"):
                remote_files.append((key, name))

    if not remote_files:
        console.print(f"[yellow]No bundle files found at s3://{bucket}/{s3_prefix}/[/yellow]")
        raise typer.Exit(0)

    local_names = {f.name for f in raw_dir.glob("*.json.gz")}
    to_download = [(k, n) for k, n in remote_files if n not in local_names]

    total_remote = len(remote_files)
    already = total_remote - len(to_download)
    console.print(
        f"  {total_remote} remote files | {already} already local | {len(to_download)} to download"
    )

    if not to_download:
        console.print("[bold green]Nothing to download — local cache is up to date.[/bold green]")
        raise typer.Exit(0)

    if dry_run:
        console.print("[dim]--dry-run: would download:[/dim]")
        for _key, name in to_download:
            console.print(f"  {name}")
        raise typer.Exit(0)

    console.print(f"[bold]Downloading {len(to_download)} file(s) to {raw_dir}...[/bold]")
    downloaded = 0
    failed = 0
    for key, name in to_download:
        local_path = raw_dir / name
        tmp_path = local_path.with_name(local_path.name + ".tmp")
        try:
            s3.download_file(bucket, key, str(tmp_path))
            tmp_path.replace(local_path)  # atomic on POSIX
            downloaded += 1
            if downloaded % 50 == 0 or downloaded == len(to_download):
                console.print(f"  {downloaded}/{len(to_download)} downloaded")
        except Exception as exc:  # noqa: BLE001
            tmp_path.unlink(missing_ok=True)
            console.print(f"  [red]Failed:[/red] {name} — {exc}")
            failed += 1

    if failed:
        console.print(
            f"[bold yellow]Done with {failed} error(s). {downloaded} downloaded.[/bold yellow]"
        )
        raise typer.Exit(1)

    console.print(f"[bold green]Done.[/bold green] {downloaded} file(s) downloaded to {raw_dir}.")


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to bind to"),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Start the FastAPI rating server."""
    import uvicorn

    from src.engine.main import create_app

    _app = create_app(db_path)
    uvicorn.run(_app, host=host, port=port)


if __name__ == "__main__":
    app()
