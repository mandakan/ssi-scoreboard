"""CLI entry point — typer app with sync, train, benchmark, and serve commands."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(name="rating", help="SSI Scoreboard rating engine CLI")
console = Console()

DB_PATH_OPTION = typer.Option(Path("data/lab.duckdb"), help="Path to DuckDB database")


@app.command()
def sync(
    url: str = typer.Option("http://localhost:3000", help="Base URL of the SSI Scoreboard app"),
    token: str = typer.Option(..., envvar="CACHE_PURGE_SECRET", help="Bearer token for auth"),
    full: bool = typer.Option(False, help="Full sync (ignore watermark)"),
    force: bool = typer.Option(False, help="Force re-download of all matches (even if already stored)"),
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
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Train rating algorithms on synced match data."""
    from src.algorithms.base import get_algorithms
    from src.data.store import Store

    store = Store(db_path)
    try:
        algorithms = get_algorithms() if algorithm == "all" else get_algorithms(algorithm)
        matches = store.get_matches_chronological()
        n_algo, n_match = len(algorithms), len(matches)
        console.print(f"[bold]Training {n_algo} algorithm(s) on {n_match} matches[/bold]")

        for algo in algorithms:
            console.print(f"\n[cyan]{algo.name}[/cyan]")
            for ct, match_id, match_date in matches:
                results = store.get_stage_results_for_match(ct, match_id)
                comp_map = store.get_competitor_shooter_map(ct, match_id)
                if not results:
                    continue
                algo.process_match_data(ct, match_id, match_date, results, comp_map)

            ratings = algo.get_ratings()
            console.print(f"  Rated {len(ratings)} shooters")

            # Save to DuckDB
            rating_data: dict[int, tuple[str, str | None, float, float, int, str | None]] = {}
            for sid, r in ratings.items():
                rating_data[sid] = (r.name, r.division, r.mu, r.sigma, r.matches_played, None)
            store.save_ratings(algo.name, rating_data)
            console.print(f"  [green]Saved ratings for {algo.name}[/green]")
    finally:
        store.close()


@app.command()
def benchmark(
    split: float = typer.Option(0.7, help="Train/test split ratio (chronological)"),
    db_path: Path = DB_PATH_OPTION,
) -> None:
    """Run benchmark comparing all algorithms."""
    from src.benchmark.runner import run_benchmark
    from src.data.store import Store

    store = Store(db_path)
    try:
        run_benchmark(store, split_ratio=split)
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
