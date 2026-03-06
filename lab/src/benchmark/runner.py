"""Benchmark runner — chronological train/test evaluation."""

from __future__ import annotations

from collections import defaultdict

from rich.console import Console

from src.algorithms.base import get_algorithms
from src.benchmark.metrics import kendall_tau, mean_reciprocal_rank, top_k_accuracy
from src.benchmark.report import print_division_report, print_report
from src.data.models import Rating
from src.data.store import Store

console = Console()

# Conservative rating: mu - z*sigma at the 70th percentile.
# z = norm.ppf(0.70) ≈ 0.5244 (precomputed constant).
_CONS_Z: float = 0.5244005122401781

# Default OpenSkill values used for unrated shooters in conservative ranking.
_DEFAULT_MU = 25.0
_DEFAULT_SIGMA = 25.0 / 3


def _conservative_rank(ratings: dict[int, Rating], shooter_ids: list[int]) -> list[int]:
    """Rank shooters by conservative rating (mu - z*sigma at 70th percentile).

    Unrated shooters receive the default mu/sigma so they sink to the bottom.
    This penalises low match counts and surfaces consistently-performing shooters.
    """
    scored = []
    for sid in shooter_ids:
        r = ratings.get(sid)
        mu = r.mu if r else _DEFAULT_MU
        sigma = r.sigma if r else _DEFAULT_SIGMA
        scored.append((sid, mu - _CONS_Z * sigma))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [sid for sid, _ in scored]


def _actual_ranking_by_division(
    store: Store, ct: int, match_id: str
) -> tuple[list[int], dict[str, list[int]]]:
    """Return (full_actual_ranking, per_division_actual_ranking).

    Full ranking: all shooters sorted by average overall_percent descending.
    Division rankings: same list split by division, preserving cross-field order.
    """
    comp_map = store.get_competitor_shooter_map(ct, match_id)
    div_map = store.get_competitor_division_map(ct, match_id)

    shooter_div: dict[int, str] = {}
    for comp_id, sid in comp_map.items():
        if sid is not None:
            d = div_map.get(comp_id)
            if d:
                shooter_div[sid] = d

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

    avg_pcts = [(sid, sum(p) / len(p)) for sid, p in shooter_pcts.items() if p]
    avg_pcts.sort(key=lambda x: x[1], reverse=True)
    full_actual = [sid for sid, _ in avg_pcts]

    by_div: dict[str, list[int]] = defaultdict(list)
    for sid in full_actual:
        d = shooter_div.get(sid)
        if d:
            by_div[d].append(sid)

    return full_actual, dict(by_div)


def _empty_metrics() -> dict[str, list[float]]:
    return {"kendall_tau": [], "top_5_accuracy": [], "top_10_accuracy": [], "mrr": []}


def _record_metrics(
    m: dict[str, list[float]],
    predicted: list[int],
    actual: list[int],
) -> None:
    m["kendall_tau"].append(kendall_tau(predicted, actual))
    m["top_5_accuracy"].append(top_k_accuracy(predicted, actual, k=5))
    m["top_10_accuracy"].append(top_k_accuracy(predicted, actual, k=10))
    m["mrr"].append(mean_reciprocal_rank(predicted, actual[:10]))


def run_benchmark(store: Store, split_ratio: float = 0.7) -> dict[str, dict[str, list[float]]]:
    """Run chronological train/test benchmark for all algorithms.

    For each algorithm, measures two ranking strategies:
    - Base: algorithm's own predict_rank() (mu-ordered for OpenSkill)
    - Conservative (+cons): mu - z*sigma at 70th percentile — penalises high uncertainty

    Also produces a per-division Kendall τ breakdown to check cross-division fairness.
    """
    matches = store.get_matches_chronological()
    if not matches:
        console.print("[red]No matches in store. Run sync first.[/red]")
        return {}

    split_idx = int(len(matches) * split_ratio)
    train_matches = matches[:split_idx]
    test_matches = matches[split_idx:]

    console.print(f"[bold]Benchmark: {len(matches)} matches[/bold]")
    console.print(f"  Train: {len(train_matches)} | Test: {len(test_matches)}")

    # Precompute actual rankings for all test matches (once, outside the algo loop).
    console.print("\n[dim]Precomputing actual rankings for test matches...[/dim]")
    test_actuals: list[tuple[list[int], dict[str, list[int]]]] = []
    for ct, match_id, _date, _level in test_matches:
        actual, by_div = _actual_ranking_by_division(store, ct, match_id)
        test_actuals.append((actual, by_div))

    algorithms = get_algorithms()

    # algo_metrics: interleaved base and +cons rows for the main report table.
    algo_metrics: dict[str, dict[str, list[float]]] = {}

    # division_taus: algo_name → division → list of per-match Kendall τ values.
    # Base algorithms only — conservative adds no new information per division.
    division_taus: dict[str, dict[str, list[float]]] = {}

    for algo in algorithms:
        console.print(f"\n[cyan]Training {algo.name}...[/cyan]")

        for ct, match_id, match_date, match_level in train_matches:
            results = store.get_stage_results_for_match(ct, match_id)
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if results:
                algo.process_match_data(
                    ct, match_id, match_date, results, comp_map, match_level=match_level
                )

        n_rated = len(algo.get_ratings())
        console.print(f"  Trained on {len(train_matches)} matches, {n_rated} shooters rated")

        base_m = _empty_metrics()
        cons_m = _empty_metrics()
        algo_div_taus: dict[str, list[float]] = defaultdict(list)

        for (ct, match_id, match_date, match_level), (actual, by_div) in zip(
            test_matches, test_actuals, strict=True
        ):
            if len(actual) < 5:
                continue

            # Snapshot ratings before the online update for this match.
            ratings = algo.get_ratings()
            predicted = algo.predict_rank(actual)
            cons_predicted = _conservative_rank(ratings, actual)

            _record_metrics(base_m, predicted, actual)
            _record_metrics(cons_m, cons_predicted, actual)

            # Per-division τ: filter the cross-field predicted ranking to each division.
            for div, div_actual in by_div.items():
                if len(div_actual) < 3:
                    continue
                div_actual_set = set(div_actual)
                div_predicted = [s for s in predicted if s in div_actual_set]
                if len(div_predicted) >= 2:
                    algo_div_taus[div].append(kendall_tau(div_predicted, div_actual))

            # Online learning — update ratings with this match before the next prediction.
            results = store.get_stage_results_for_match(ct, match_id)
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if results:
                algo.process_match_data(
                    ct, match_id, match_date, results, comp_map, match_level=match_level
                )

        # Insert interleaved: base row, then conservative row.
        algo_metrics[algo.name] = base_m
        algo_metrics[f"{algo.name}+cons"] = cons_m
        division_taus[algo.name] = dict(algo_div_taus)

        n_tested = len(base_m["kendall_tau"])
        console.print(f"  Tested on {n_tested} matches")

    print_report(algo_metrics)
    print_division_report(division_taus, min_matches=5)
    return algo_metrics
