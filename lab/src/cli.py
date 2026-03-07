"""CLI entry point — typer app with sync, train, benchmark, and serve commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import typer
from rich.console import Console

app = typer.Typer(name="rating", help="SSI Scoreboard rating engine CLI")
console = Console()

DB_PATH_OPTION = typer.Option(Path("data/lab.duckdb"), help="Path to DuckDB database")


def _run_train_mode(
    store: Any,
    algorithms: Any,
    matches: list[tuple[str, int, str, str | None, str | None]],
    scoring: str,
    skip_set: set[tuple[str, int, str]] | None = None,
) -> None:
    """Train all algorithm instances on matches for one scoring mode and save ratings."""
    from src.data.store import RatingRow

    suffix = "" if scoring == "stage_hf" else "_mpct"
    skip = skip_set or set()

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
            else:
                scores = store.get_match_scores(source, ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            if not results:
                continue
            algo.process_match_data(
                ct, match_id, match_date, results, comp_map,
                name_map=store.get_competitor_name_map(source, ct, match_id),
                division_map=store.get_competitor_division_map(source, ct, match_id),
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
        console.print(f"  Rated {len(ratings)} shooters")
        stored_name = f"{algo.name}{suffix}"
        rating_data: dict[int, RatingRow] = {
            sid: (
                r.name, r.division, r.region, r.category,
                r.mu, r.sigma, r.matches_played,
                shooter_last_date.get(sid),
            )
            for sid, r in ratings.items()
        }
        store.save_ratings(stored_name, rating_data)
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
    delay: float = typer.Option(
        0.3, help="Delay between matches in seconds (inter-match only)"
    ),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Sync match data from ipscresults.org OData API.

    Downloads L3+ (National/Continental/World) match results for all disciplines
    (Handgun, Rifle, Shotgun, …) by default. Use --disciplines to restrict to a
    subset. These complement the SSI dataset which is mostly L2 (Regional).

    Run 'rating link' afterwards to resolve shooter identities and remove
    cross-source duplicates before training.
    """
    from src.data.ipscresults import IpscResultsClient, IpscResultsSyncer
    from src.data.store import Store

    disc_set: set[str] | None = (
        {d.strip() for d in disciplines.split(",") if d.strip()} if disciplines else None
    )
    store = Store(db_path)
    jitter = min(delay * 0.3, 0.1) if delay > 0 else 0.0
    client = IpscResultsClient(delay=delay, jitter=jitter)
    syncer = IpscResultsSyncer(client, store, level_min=level_min, disciplines=disc_set)
    try:
        syncer.sync(full=full)
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
    algorithm: str = typer.Option("all", help="Algorithm to train: openskill, elo, or all"),
    scoring: str = typer.Option(
        "stage_hf",
        help="Scoring mode: stage_hf (per-stage hit factor) or match_pct (whole-match points)",
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

    Tip: run 'rating link' before training to resolve cross-source shooter identities
    and exclude duplicate matches from the training set.
    """
    from src.algorithms.base import get_algorithms
    from src.data.store import Store

    if scoring not in ("stage_hf", "match_pct"):
        console.print(f"[red]Unknown scoring mode '{scoring}'. Use stage_hf or match_pct.[/red]")
        raise typer.Exit(1)

    store = Store(db_path)
    try:
        algorithms = get_algorithms() if algorithm == "all" else get_algorithms(algorithm)
        matches = store.get_matches_chronological()
        skip_set = store.get_dedup_skip_set()
        n_algo, n_match = len(algorithms), len(matches)
        mode_label = "stage HF" if scoring == "stage_hf" else "match %"
        console.print(
            f"[bold]Training {n_algo} algorithm(s) on {n_match} matches "
            f"(scoring: {mode_label}, dedup skip: {len(skip_set)})[/bold]"
        )

        _run_train_mode(store, algorithms, matches, scoring, skip_set=skip_set)
    finally:
        store.close()


@app.command()
def benchmark(
    split: float = typer.Option(0.7, help="Train/test split ratio (chronological)"),
    chart: bool = typer.Option(False, help="Save a comparison chart to data/benchmark.png"),
    scoring: str = typer.Option(
        "stage_hf",
        help="Scoring mode: stage_hf, match_pct, or all (runs both, combined table)",
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

    store = Store(db_path)
    try:
        algo_metrics = run_benchmark(store, split_ratio=split, scoring=scoring)
        if chart and algo_metrics:
            save_chart(algo_metrics, output_path=str(db_path.parent / "benchmark.png"))
    finally:
        store.close()


@app.command()
def export(
    output_dir: Path = typer.Option(Path("site"), help="Output directory for the static explorer"),  # noqa: B008
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

    store = Store(db_path)
    try:
        data = export_data(store)
        generate_site(data, output_dir)
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
        for scoring in ("stage_hf", "match_pct"):
            mode_label = "stage HF" if scoring == "stage_hf" else "match %"
            console.rule(f"[bold blue]Step 4/5 — Train ({mode_label})[/bold blue]")
            console.print(
                f"  {len(matches)} matches · {len(skip_set)} skipped (dedup)"
                f" · scoring: {mode_label}"
            )
            _run_train_mode(store, get_algorithms(), matches, scoring, skip_set=skip_set)

        console.rule("[bold blue]Step 5/5 — Export[/bold blue]")
        data = export_data(store)
        generate_site(data, output_dir)
        console.print("\n[bold green]Pipeline complete![/bold green]")
    finally:
        store.close()


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
