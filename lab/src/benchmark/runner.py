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


def _get_results(
    store: Store, ct: int, match_id: str, scoring: str
) -> list[tuple[int, int, float | None, bool, bool, bool]]:
    """Return stage results in the format expected by process_match_data.

    stage_hf  — one row per stage per competitor (hit factor as metric).
    match_pct — one synthetic row per competitor; metric is total match points.
                Treating the whole match as a single ranking event aligns with
                how IPSC officially scores competitors.
    """
    if scoring == "stage_hf":
        return store.get_stage_results_for_match(ct, match_id)
    scores = store.get_match_scores(ct, match_id)
    # Synthetic stage_id = 0; dnf=False because absent competitors are already excluded
    return [(cid, 0, pts, is_dq, False, is_zeroed) for cid, pts, is_dq, is_zeroed in scores]


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


def _run_mode(
    store: Store,
    train_matches: list[tuple[int, str, str | None, str | None]],
    test_matches: list[tuple[int, str, str | None, str | None]],
    test_actuals: list[tuple[list[int], dict[str, list[int]]]],
    scoring: str,
) -> tuple[dict[str, dict[str, list[float]]], dict[str, dict[str, list[float]]]]:
    """Train and evaluate all algorithms for one scoring mode.

    Returns (algo_metrics, division_taus) with algorithm names suffixed by
    '_mpct' when scoring == 'match_pct' so both modes can coexist in one table.
    """
    algo_metrics: dict[str, dict[str, list[float]]] = {}
    division_taus: dict[str, dict[str, list[float]]] = {}

    for algo in get_algorithms():
        console.print(f"\n[cyan]Training {algo.name}[/cyan] ({scoring})")

        for ct, match_id, match_date, match_level in train_matches:
            results = _get_results(store, ct, match_id, scoring)
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

            ratings = algo.get_ratings()
            predicted = algo.predict_rank(actual)
            cons_predicted = _conservative_rank(ratings, actual)

            _record_metrics(base_m, predicted, actual)
            _record_metrics(cons_m, cons_predicted, actual)

            for div, div_actual in by_div.items():
                if len(div_actual) < 3:
                    continue
                div_actual_set = set(div_actual)
                div_predicted = [s for s in predicted if s in div_actual_set]
                if len(div_predicted) >= 2:
                    algo_div_taus[div].append(kendall_tau(div_predicted, div_actual))

            results = _get_results(store, ct, match_id, scoring)
            comp_map = store.get_competitor_shooter_map(ct, match_id)
            if results:
                algo.process_match_data(
                    ct, match_id, match_date, results, comp_map, match_level=match_level
                )

        suffix = "" if scoring == "stage_hf" else "_mpct"
        name = f"{algo.name}{suffix}"
        algo_metrics[name] = base_m
        algo_metrics[f"{name}+cons"] = cons_m
        division_taus[name] = dict(algo_div_taus)
        console.print(f"  Tested on {len(base_m['kendall_tau'])} matches")

    return algo_metrics, division_taus


def run_benchmark(
    store: Store,
    split_ratio: float = 0.7,
    scoring: str = "stage_hf",
) -> dict[str, dict[str, list[float]]]:
    """Run chronological train/test benchmark for all algorithms.

    scoring:
      stage_hf  — rank by hit factor on each stage independently (default).
                  More data points per match; each stage is a separate event.
      match_pct — rank by total match points; one event per match.
                  Aligns with IPSC's official scoring; fewer but holistic signals.
      all       — run both modes and show them side-by-side in one combined table.

    For each algorithm × scoring mode, measures:
    - Base: algorithm's own predict_rank() (mu-ordered)
    - Conservative (+cons): mu − z×σ at 70th percentile

    Also produces a per-division Kendall τ breakdown for cross-division fairness.
    """
    matches = store.get_matches_chronological()
    if not matches:
        console.print("[red]No matches in store. Run sync first.[/red]")
        return {}

    split_idx = int(len(matches) * split_ratio)
    train_matches = matches[:split_idx]
    test_matches = matches[split_idx:]

    modes = ["stage_hf", "match_pct"] if scoring == "all" else [scoring]
    mode_label = " + ".join("stage HF" if m == "stage_hf" else "match %" for m in modes)
    console.print(f"[bold]Benchmark: {len(matches)} matches — scoring: {mode_label}[/bold]")
    console.print(f"  Train: {len(train_matches)} | Test: {len(test_matches)}")

    console.print("\n[dim]Precomputing actual rankings for test matches...[/dim]")
    test_actuals: list[tuple[list[int], dict[str, list[int]]]] = []
    for ct, match_id, _date, _level in test_matches:
        actual, by_div = _actual_ranking_by_division(store, ct, match_id)
        test_actuals.append((actual, by_div))

    all_metrics: dict[str, dict[str, list[float]]] = {}
    all_div_taus: dict[str, dict[str, list[float]]] = {}

    for mode in modes:
        m, d = _run_mode(store, train_matches, test_matches, test_actuals, mode)
        all_metrics.update(m)
        all_div_taus.update(d)

    print_report(all_metrics)
    print_division_report(all_div_taus, min_matches=5)
    return all_metrics
