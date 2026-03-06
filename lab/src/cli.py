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
    matches: list[tuple[int, str, str | None, str | None]],
    scoring: str,
) -> None:
    """Train all algorithm instances on matches for one scoring mode and save ratings."""
    from src.data.store import RatingRow

    suffix = "" if scoring == "stage_hf" else "_mpct"
    for algo in algorithms:
        console.print(f"\n[cyan]{algo.name}[/cyan]")
        shooter_last_date: dict[int, str] = {}

        for ct, match_id, match_date, match_level in matches:
            if scoring == "stage_hf":
                results = store.get_stage_results_for_match(ct, match_id)
            else:
                scores = store.get_match_scores(ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if not results:
                continue
            algo.process_match_data(
                ct, match_id, match_date, results, comp_map,
                name_map=store.get_competitor_name_map(ct, match_id),
                division_map=store.get_competitor_division_map(ct, match_id),
                region_map=store.get_competitor_region_map(ct, match_id),
                category_map=store.get_competitor_category_map(ct, match_id),
                match_level=match_level,
            )
            if match_date:
                for sid in comp_map.values():
                    if sid is not None:
                        shooter_last_date[sid] = match_date

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
    url: str = typer.Option("http://localhost:3000", help="Base URL of the SSI Scoreboard app"),
    token: str = typer.Option(..., envvar="CACHE_PURGE_SECRET", help="Bearer token for auth"),
    full: bool = typer.Option(False, help="Full sync (ignore watermark)"),
    force: bool = typer.Option(False, help="Force re-download of all matches (even if already stored)"),  # noqa: E501
    delay: float = typer.Option(2.0, help="Delay between requests in seconds (0 for no delay)"),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Sync match data from the app into the local DuckDB store."""
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
        n_algo, n_match = len(algorithms), len(matches)
        mode_label = "stage HF" if scoring == "stage_hf" else "match %"
        console.print(
            f"[bold]Training {n_algo} algorithm(s) on {n_match} matches "
            f"(scoring: {mode_label})[/bold]"
        )

        _run_train_mode(store, algorithms, matches, scoring)
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
    url: str = typer.Option("http://localhost:3000", help="Base URL of the SSI Scoreboard app"),
    token: str = typer.Option(..., envvar="CACHE_PURGE_SECRET", help="Bearer token for auth"),
    full: bool = typer.Option(False, help="Full sync (ignore watermark)"),
    force: bool = typer.Option(False, help="Force re-download of all matches"),
    delay: float = typer.Option(2.0, help="Delay between requests in seconds"),
    output_dir: Path = typer.Option(Path("site"), help="Output directory for the static explorer"),  # noqa: B008
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Run the full pipeline: sync → train (stage HF + match %) → export.

    Equivalent to running sync, train --scoring stage_hf, train --scoring match_pct,
    and export in sequence. Both scoring modes are trained so the exported explorer
    lets you switch between them without re-running anything.
    """
    from src.algorithms.base import get_algorithms
    from src.data.exporter import export_data
    from src.data.store import Store
    from src.data.sync import SyncClient
    from src.engine.page import generate_site

    store = Store(db_path)
    try:
        console.rule("[bold blue]Step 1/3 — Sync[/bold blue]")
        jitter = min(delay * 0.5, 1.0) if delay > 0 else 0.0
        client = SyncClient(url, token, store, delay=delay, jitter=jitter)
        try:
            client.sync(full=full, force=force)
        finally:
            client.close()

        matches = store.get_matches_chronological()
        for scoring in ("stage_hf", "match_pct"):
            mode_label = "stage HF" if scoring == "stage_hf" else "match %"
            console.rule(f"[bold blue]Step 2/3 — Train ({mode_label})[/bold blue]")
            console.print(f"  {len(matches)} matches · scoring: {mode_label}")
            _run_train_mode(store, get_algorithms(), matches, scoring)

        console.rule("[bold blue]Step 3/3 — Export[/bold blue]")
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
