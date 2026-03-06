"""Benchmark runner — chronological train/test evaluation."""

from __future__ import annotations

from collections import defaultdict

from rich.console import Console

from src.algorithms.base import get_algorithms
from src.benchmark.metrics import kendall_tau, mean_reciprocal_rank, top_k_accuracy
from src.benchmark.report import print_report
from src.data.store import Store

console = Console()


def _actual_ranking_for_match(
    store: Store, ct: int, match_id: str
) -> list[int]:
    """Compute actual overall ranking for a match based on average overall_percent.

    Returns shooter_ids sorted by average overall_percent descending (best first).
    Only includes shooters with a valid shooter_id and at least one non-DNF stage.
    """
    comp_map = store.get_competitor_shooter_map(ct, match_id)

    # Accumulate overall_percent per shooter (via competitor_id → shooter_id)
    # We need the full stage_results with overall_percent, which requires a richer query
    rows = store.db.execute(
        """SELECT competitor_id, overall_percent
           FROM stage_results
           WHERE ct = ? AND match_id = ? AND dnf = false AND overall_percent IS NOT NULL""",
        [ct, match_id],
    ).fetchall()

    shooter_pcts: dict[int, list[float]] = defaultdict(list)
    for comp_id, pct in rows:
        sid = comp_map.get(comp_id)
        if sid is not None:
            shooter_pcts[sid].append(pct)

    # Average overall_percent per shooter, sort descending
    avg_pcts = [(sid, sum(pcts) / len(pcts)) for sid, pcts in shooter_pcts.items() if pcts]
    avg_pcts.sort(key=lambda x: x[1], reverse=True)
    return [sid for sid, _ in avg_pcts]


def run_benchmark(store: Store, split_ratio: float = 0.7) -> None:
    """Run chronological train/test benchmark for all algorithms."""
    matches = store.get_matches_chronological()
    if not matches:
        console.print("[red]No matches in store. Run sync first.[/red]")
        return

    split_idx = int(len(matches) * split_ratio)
    train_matches = matches[:split_idx]
    test_matches = matches[split_idx:]

    console.print(f"[bold]Benchmark: {len(matches)} matches[/bold]")
    console.print(f"  Train: {len(train_matches)} | Test: {len(test_matches)}")

    algorithms = get_algorithms()
    algo_metrics: dict[str, dict[str, list[float]]] = {}

    for algo in algorithms:
        console.print(f"\n[cyan]Training {algo.name}...[/cyan]")

        # Train phase
        for ct, match_id, match_date, match_level in train_matches:
            results = store.get_stage_results_for_match(ct, match_id)
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if results:
                algo.process_match_data(
                    ct, match_id, match_date, results, comp_map, match_level=match_level
                )

        n_rated = len(algo.get_ratings())
        console.print(f"  Trained on {len(train_matches)} matches, {n_rated} shooters rated")

        # Test phase — online learning during test
        metrics: dict[str, list[float]] = {
            "kendall_tau": [],
            "top_5_accuracy": [],
            "top_10_accuracy": [],
            "mrr": [],
        }

        for ct, match_id, match_date, match_level in test_matches:
            # Get actual ranking
            actual = _actual_ranking_for_match(store, ct, match_id)
            if len(actual) < 5:
                # Skip very small matches
                continue

            # Predict ranking using current ratings
            predicted = algo.predict_rank(actual)

            # Compute metrics
            metrics["kendall_tau"].append(kendall_tau(predicted, actual))
            metrics["top_5_accuracy"].append(top_k_accuracy(predicted, actual, k=5))
            metrics["top_10_accuracy"].append(top_k_accuracy(predicted, actual, k=10))
            metrics["mrr"].append(mean_reciprocal_rank(predicted, actual[:10]))

            # Online learning — process this match to update ratings for future predictions
            results = store.get_stage_results_for_match(ct, match_id)
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if results:
                algo.process_match_data(
                    ct, match_id, match_date, results, comp_map, match_level=match_level
                )

        algo_metrics[algo.name] = metrics
        n_tested = len(metrics["kendall_tau"])
        console.print(f"  Tested on {n_tested} matches")

    print_report(algo_metrics)
