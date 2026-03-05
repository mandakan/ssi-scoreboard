"""Scheduled recalculation for the rating engine."""

from __future__ import annotations

from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from rich.console import Console

console = Console()


def _recalc(db_path: Path, app_url: str, token: str) -> None:
    """Sync new data and retrain all algorithms."""
    from src.algorithms.base import get_algorithms
    from src.data.store import Store
    from src.data.sync import SyncClient

    store = Store(db_path)
    try:
        # Sync new matches
        client = SyncClient(app_url, token, store)
        try:
            new_count = client.sync(full=False)
        finally:
            client.close()

        if new_count == 0:
            console.print("[dim]No new matches — skipping retrain[/dim]")
            return

        # Retrain all algorithms
        algorithms = get_algorithms()
        matches = store.get_matches_chronological()
        for algo in algorithms:
            for ct, match_id, match_date in matches:
                results = store.get_stage_results_for_match(ct, match_id)
                comp_map = store.get_competitor_shooter_map(ct, match_id)
                if results:
                    name_map = store.get_competitor_name_map(ct, match_id)
                    div_map = store.get_competitor_division_map(ct, match_id)
                    region_map = store.get_competitor_region_map(ct, match_id)
                    cat_map = store.get_competitor_category_map(ct, match_id)
                    algo.process_match_data(
                        ct, match_id, match_date, results, comp_map,
                        name_map=name_map, division_map=div_map,
                        region_map=region_map, category_map=cat_map,
                    )

            ratings = algo.get_ratings()
            from src.data.store import RatingRow
            rating_data: dict[int, RatingRow] = {}
            for sid, r in ratings.items():
                rating_data[sid] = (
                    r.name, r.division, r.region, r.category,
                    r.mu, r.sigma, r.matches_played, None,
                )
            store.save_ratings(algo.name, rating_data)

        n = len(algorithms)
        console.print(f"[green]Retrained {n} algorithms after {new_count} new matches[/green]")
    finally:
        store.close()


def start_scheduler(
    db_path: Path,
    app_url: str,
    token: str,
    interval_hours: int = 6,
) -> BackgroundScheduler:
    """Start background scheduler for periodic recalculation."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _recalc,
        "interval",
        hours=interval_hours,
        args=[db_path, app_url, token],
        id="recalc",
        name="Sync and retrain ratings",
    )
    scheduler.start()
    console.print(f"[green]Scheduler started — recalc every {interval_hours}h[/green]")
    return scheduler
