"""Hyperparameter grid search for rating algorithms.

Evaluates algorithm configurations by training on a chronological train split
and measuring predictive quality on a held-out test split. Each configuration
is independent and can run in parallel.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.data.store import Store

from rich.console import Console
from rich.table import Table

from src.algorithms.base import DivKey, RatingAlgorithm
from src.benchmark.metrics import kendall_tau, mean_reciprocal_rank, top_k_accuracy
from src.data.models import Rating

console = Console()

# Conservative rating: mu - z*sigma at the 70th percentile.
_CONS_Z_DEFAULT: float = 0.5244005122401781
_DEFAULT_MU = 25.0
_DEFAULT_SIGMA = 25.0 / 3


@dataclass
class TuneConfig:
    """One hyperparameter configuration to evaluate."""

    algo_class: str  # e.g. "elo", "openskill_bt_lvl"
    params: dict[str, float | int]
    label: str
    # Scoring-mode-specific parameters (e.g. anchor_percentile for match_pct_combined).
    # These are separate from algo hyperparams and not passed to the algorithm constructor.
    scoring_params: dict[str, str | float] = field(default_factory=dict)


@dataclass
class TuneResult:
    """Evaluation results for one configuration."""

    config: TuneConfig
    scoring: str
    metrics: dict[str, float]  # mean of each metric
    cons_metrics: dict[str, float]  # conservative ranking variant
    elapsed_s: float


@dataclass
class DataQuality:
    """Data quality summary for the sweep run."""

    total_matches: int = 0
    train_matches: int = 0
    test_matches: int = 0
    fuzzy_link_count: int = 0
    fuzzy_link_low_conf: int = 0
    identity_coverage: float = 0.0
    avg_competitors_per_match: float = 0.0
    date_range_train: list[str | None] = field(default_factory=lambda: [None, None])
    date_range_test: list[str | None] = field(default_factory=lambda: [None, None])


def _make_algo(config: TuneConfig) -> RatingAlgorithm:
    """Instantiate an algorithm with the given hyperparameters."""
    from src.algorithms.elo import MultiElo
    from src.algorithms.ics import ICSAlgorithm
    from src.algorithms.openskill_bt import OpenSkillBT
    from src.algorithms.openskill_bt_lvl import OpenSkillBTLvl
    from src.algorithms.openskill_bt_lvl_decay import OpenSkillBTLvlDecay
    from src.algorithms.openskill_pl import OpenSkillPL
    from src.algorithms.openskill_pl_decay import OpenSkillPLDecay

    mapping: dict[str, type[RatingAlgorithm]] = {
        "elo": MultiElo,
        "ics": ICSAlgorithm,
        "openskill": OpenSkillPL,
        "openskill_bt": OpenSkillBT,
        "openskill_bt_lvl": OpenSkillBTLvl,
        "openskill_pl_decay": OpenSkillPLDecay,
        "openskill_bt_lvl_decay": OpenSkillBTLvlDecay,
    }
    cls = mapping[config.algo_class]
    return cls(**config.params)


def get_search_space(scoring: str = "match_pct") -> list[TuneConfig]:
    """Define the full hyperparameter grid.

    For ``match_pct_combined`` scoring, returns algorithm configs cross-producted
    with anchor hyperparameters (percentile × source filter). For other scoring
    modes the anchor params are ignored and not included.
    """
    configs: list[TuneConfig] = []

    # ELO: default_k x min_k x k_decay_matches
    for k in [24.0, 32.0, 40.0, 48.0]:
        for min_k in [8.0, 12.0, 16.0]:
            for decay in [15, 20, 30]:
                if min_k >= k:
                    continue  # skip invalid: min_k must be < default_k
                configs.append(
                    TuneConfig(
                        algo_class="elo",
                        params={"default_k": k, "min_k": min_k, "k_decay_matches": decay},
                        label=f"elo(K={k},min={min_k},decay={decay})",
                    )
                )

    # OpenSkill BT+Level: level_scale
    for scale in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]:
        configs.append(
            TuneConfig(
                algo_class="openskill_bt_lvl",
                params={"level_scale": scale},
                label=f"bt_lvl(scale={scale})",
            )
        )

    # OpenSkill PL+Decay: tau
    for tau in [0.04, 0.06, 0.083, 0.10, 0.12, 0.15]:
        configs.append(
            TuneConfig(
                algo_class="openskill_pl_decay",
                params={"tau": tau},
                label=f"pl_decay(\u03c4={tau})",
            )
        )

    # OpenSkill BT+Level+Decay: level_scale x tau
    for scale in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]:
        for tau in [0.04, 0.06, 0.083, 0.10, 0.12, 0.15]:
            configs.append(
                TuneConfig(
                    algo_class="openskill_bt_lvl_decay",
                    params={"level_scale": scale, "tau": tau},
                    label=f"bt_lvl_decay(scale={scale},\u03c4={tau})",
                )
            )

    # Baselines (no tunable params -- included for comparison)
    configs.append(TuneConfig("openskill", {}, "openskill(baseline)"))
    configs.append(TuneConfig("openskill_bt", {}, "openskill_bt(baseline)"))

    # ICS 2.0: anchor_percentile × top_n.
    # Only evaluated with match_pct scoring (ICS handles division weighting
    # internally; stage_hf and match_pct_combined would double-normalise).
    if scoring == "match_pct":
        for ap in [50, 60, 67, 75, 80]:
            for n in [2, 3, 4, 5]:
                configs.append(
                    TuneConfig(
                        algo_class="ics",
                        params={"anchor_percentile": float(ap), "top_n": n},
                        label=f"ics(p={ap},n={n})",
                    )
                )

    if scoring != "match_pct_combined":
        return configs

    # match_pct_combined: cross-product of top algorithms × anchor hyperparameters.
    # We sweep anchor_percentile and anchor_source; algo params use their default values.
    # The per-mode configs above are NOT used for combined scoring (they have no
    # scoring_params), so we build a fresh combined list here and return it.
    combined: list[TuneConfig] = []
    anchor_percentiles = [50, 60, 67, 75, 80]
    anchor_sources = ["l4plus", "l3plus"]

    # PL+Decay — best algorithm for match_pct; sweep tau × anchor hyperparams.
    for tau in [0.04, 0.083, 0.15]:
        for ap in anchor_percentiles:
            for asrc in anchor_sources:
                combined.append(
                    TuneConfig(
                        algo_class="openskill_pl_decay",
                        params={"tau": tau},
                        label=f"pl_decay(\u03c4={tau},p={ap},{asrc})",
                        scoring_params={"anchor_percentile": ap, "anchor_source": asrc},
                    )
                )

    # BT+Level+Decay — second-best; sweep a representative scale × tau × anchor params.
    for scale in [1.0, 1.5]:
        for tau in [0.083, 0.15]:
            for ap in anchor_percentiles:
                for asrc in anchor_sources:
                    combined.append(
                        TuneConfig(
                            algo_class="openskill_bt_lvl_decay",
                            params={"level_scale": scale, "tau": tau},
                            label=f"bt_lvl_decay(scale={scale},\u03c4={tau},p={ap},{asrc})",
                            scoring_params={"anchor_percentile": ap, "anchor_source": asrc},
                        )
                    )

    # Baselines with default anchor settings for combined mode.
    for ap in [67]:
        for asrc in anchor_sources:
            combined.append(
                TuneConfig(
                    "openskill",
                    {},
                    f"openskill(baseline,p={ap},{asrc})",
                    scoring_params={"anchor_percentile": ap, "anchor_source": asrc},
                )
            )
            combined.append(
                TuneConfig(
                    "openskill_bt",
                    {},
                    f"openskill_bt(baseline,p={ap},{asrc})",
                    scoring_params={"anchor_percentile": ap, "anchor_source": asrc},
                )
            )

    return combined


def _compute_division_weights_for_sweep(
    store: Store,
    train_matches: list[tuple[str, int, str, str | None, str | None]],
    anchor_percentile: float,
    anchor_source: str,
) -> dict[str | None, float]:
    """Pre-compute division weights from a filtered subset of training matches.

    anchor_source:
      "l4plus"  — use only L4/L5 matches (World/Continental championships).
      "l3plus"  — use L3, L4, and L5 matches (National + above).

    Falls back to all training matches if no anchor matches qualify under the filter.
    """
    from src.algorithms.base import compute_division_weights

    if anchor_source == "l4plus":
        anchor_keys = [
            (s, ct, mid) for s, ct, mid, _d, lvl in train_matches if lvl in ("l4", "l5")
        ]
    else:  # l3plus
        anchor_keys = [
            (s, ct, mid) for s, ct, mid, _d, lvl in train_matches if lvl in ("l3", "l4", "l5")
        ]

    if not anchor_keys:
        # No qualifying matches — fall back to the full training set.
        anchor_keys = [(s, ct, mid) for s, ct, mid, _d, _l in train_matches]

    pct_by_div = store.get_overall_pct_by_division(anchor_keys)
    return compute_division_weights(pct_by_div, anchor_percentile)


def _conservative_rank(
    ratings: dict[DivKey, Rating],
    shooter_ids: list[int],
    cons_z: float,
) -> list[int]:
    """Rank shooters by best conservative rating across all divisions."""
    best_cr: dict[int, float] = {}
    for (sid, _div), r in ratings.items():
        cr = r.mu - cons_z * r.sigma
        if sid not in best_cr or cr > best_cr[sid]:
            best_cr[sid] = cr

    default_cr = _DEFAULT_MU - cons_z * _DEFAULT_SIGMA
    scored = [(sid, best_cr.get(sid, default_cr)) for sid in shooter_ids]
    scored.sort(key=lambda x: x[1], reverse=True)
    return [sid for sid, _ in scored]


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


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _evaluate_config(
    config: TuneConfig,
    db_path: Path,
    train_matches: list[tuple[str, int, str, str | None, str | None]],
    test_match_keys: list[tuple[str, int, str]],
    scoring: str,
    cons_z: float,
) -> TuneResult:
    """Train one algorithm config and evaluate on the test split.

    Runs in a subprocess -- opens its own read-only DB connection.
    """
    from src.data.store import Store

    t0 = time.monotonic()
    algo = _make_algo(config)
    store = Store(db_path, read_only=True)

    try:
        # Pre-compute division weights for combined scoring (before the training loop).
        division_weights: dict[str | None, float] = {}
        if scoring == "match_pct_combined":
            anchor_percentile = float(config.scoring_params.get("anchor_percentile", 67.0))
            anchor_source = str(config.scoring_params.get("anchor_source", "l4plus"))
            division_weights = _compute_division_weights_for_sweep(
                store, train_matches, anchor_percentile, anchor_source
            )

        # Train phase
        for source, ct, match_id, match_date, match_level in train_matches:
            if scoring == "stage_hf":
                results = store.get_stage_results_for_match(source, ct, match_id)
                division_map_arg = store.get_competitor_division_map(source, ct, match_id)
            elif scoring == "match_pct_combined":
                pct_scores = store.get_match_scores_pct(source, ct, match_id)
                results = []
                for cid, avg_pct, is_dq, is_zeroed, division in pct_scores:
                    w = division_weights.get(division, 100.0)
                    normalized = (avg_pct / w * 100.0) if w > 0 else avg_pct
                    results.append((cid, 0, normalized, is_dq, False, is_zeroed))
                # Pass division_map=None so all competitors rank in one combined group.
                division_map_arg = None
            else:
                scores = store.get_match_scores(source, ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
                division_map_arg = store.get_competitor_division_map(source, ct, match_id)
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            if not results:
                continue
            algo.process_match_data(
                ct,
                match_id,
                match_date,
                results,
                comp_map,
                division_map=division_map_arg,
                match_level=match_level,
            )

        # Evaluate phase
        base_m = _empty_metrics()
        cons_m = _empty_metrics()

        for source, ct, match_id in test_match_keys:
            # Compute actual ranking from overall_percent
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            rows = store.db.execute(
                """SELECT competitor_id, overall_percent
                   FROM stage_results
                   WHERE source = ? AND ct = ? AND match_id = ?
                     AND dnf = false AND overall_percent IS NOT NULL""",
                [source, ct, match_id],
            ).fetchall()

            shooter_pcts: dict[int, list[float]] = defaultdict(list)
            for comp_id, pct in rows:
                sid = comp_map.get(comp_id)
                if sid is not None:
                    shooter_pcts[sid].append(pct)

            avg_pcts = [
                (sid, sum(p) / len(p)) for sid, p in shooter_pcts.items() if p
            ]
            avg_pcts.sort(key=lambda x: x[1], reverse=True)
            actual = [sid for sid, _ in avg_pcts]

            if len(actual) < 5:
                continue

            cur_ratings = algo.get_ratings()
            predicted = algo.predict_rank(actual)
            cons_predicted = _conservative_rank(cur_ratings, actual, cons_z)

            _record_metrics(base_m, predicted, actual)
            _record_metrics(cons_m, cons_predicted, actual)

            # Online update: process test match data so future test predictions benefit
            match_date_row = store.db.execute(
                "SELECT date FROM matches WHERE source = ? AND ct = ? AND match_id = ?",
                [source, ct, match_id],
            ).fetchone()
            match_date = str(match_date_row[0]) if match_date_row and match_date_row[0] else None
            level_row = store.db.execute(
                "SELECT level FROM matches WHERE source = ? AND ct = ? AND match_id = ?",
                [source, ct, match_id],
            ).fetchone()
            match_level = level_row[0] if level_row else None

            if scoring == "stage_hf":
                results = store.get_stage_results_for_match(source, ct, match_id)
                test_div_map = store.get_competitor_division_map(source, ct, match_id)
            elif scoring == "match_pct_combined":
                pct_scores = store.get_match_scores_pct(source, ct, match_id)
                results = []
                for cid, avg_pct, is_dq, is_zeroed, division in pct_scores:
                    w = division_weights.get(division, 100.0)
                    normalized = (avg_pct / w * 100.0) if w > 0 else avg_pct
                    results.append((cid, 0, normalized, is_dq, False, is_zeroed))
                test_div_map = None
            else:
                scores = store.get_match_scores(source, ct, match_id)
                results = [
                    (cid, 0, pts, is_dq, False, is_zeroed)
                    for cid, pts, is_dq, is_zeroed in scores
                ]
                test_div_map = store.get_competitor_division_map(source, ct, match_id)
            if results:
                algo.process_match_data(
                    ct,
                    match_id,
                    match_date,
                    results,
                    comp_map,
                    division_map=test_div_map,
                    match_level=match_level,
                )
    finally:
        store.close()

    elapsed = time.monotonic() - t0

    return TuneResult(
        config=config,
        scoring=scoring,
        metrics={k: _mean(v) for k, v in base_m.items()},
        cons_metrics={k: _mean(v) for k, v in cons_m.items()},
        elapsed_s=elapsed,
    )


def _compute_data_quality(
    db_path: Path,
    all_matches: list[tuple[str, int, str, str | None, str | None]],
    train_matches: list[tuple[str, int, str, str | None, str | None]],
    test_matches: list[tuple[str, int, str, str | None, str | None]],
    test_match_keys: list[tuple[str, int, str]],
) -> DataQuality:
    """Compute data quality metrics from the store."""
    from src.data.store import Store

    dq = DataQuality()
    dq.total_matches = len(all_matches)
    dq.train_matches = len(train_matches)
    dq.test_matches = len(test_matches)

    store = Store(db_path, read_only=True)
    try:
        # Fuzzy link counts
        fuzzy_rows = store.db.execute(
            "SELECT confidence FROM shooter_identity_links WHERE method = 'auto_fuzzy'"
        ).fetchall()
        dq.fuzzy_link_count = len(fuzzy_rows)
        dq.fuzzy_link_low_conf = sum(1 for r in fuzzy_rows if r[0] is not None and r[0] < 0.90)

        # Identity coverage in test matches
        total_test_competitors = 0
        resolved_test_competitors = 0
        for source, ct, match_id in test_match_keys:
            comp_map = store.get_canonical_competitor_map(source, ct, match_id)
            for _comp_id, canonical_id in comp_map.items():
                total_test_competitors += 1
                if canonical_id is not None:
                    resolved_test_competitors += 1
        dq.identity_coverage = (
            resolved_test_competitors / total_test_competitors
            if total_test_competitors > 0
            else 0.0
        )

        # Average competitors per test match
        comp_counts: list[int] = []
        for source, ct, match_id in test_match_keys:
            row = store.db.execute(
                "SELECT competitor_count FROM matches"
                " WHERE source = ? AND ct = ? AND match_id = ?",
                [source, ct, match_id],
            ).fetchone()
            if row and row[0] is not None:
                comp_counts.append(int(row[0]))
        dq.avg_competitors_per_match = _mean([float(c) for c in comp_counts])

        # Date ranges
        train_dates = [d for _, _, _, d, _ in train_matches if d]
        test_dates = [d for _, _, _, d, _ in test_matches if d]
        if train_dates:
            dq.date_range_train = [min(train_dates), max(train_dates)]
        if test_dates:
            dq.date_range_test = [min(test_dates), max(test_dates)]
    finally:
        store.close()

    return dq


# Default parameter values used by each algorithm — for highlighting in the results table.
_DEFAULT_LABELS: set[str] = {
    "elo(K=32.0,min=16.0,decay=20)",
    "bt_lvl(scale=1.0)",
    "pl_decay(\u03c4=0.083)",
    "bt_lvl_decay(scale=1.0,\u03c4=0.083)",
    "openskill(baseline)",
    "openskill_bt(baseline)",
    # ICS 2.0 defaults: 67th-percentile anchor, top-3 results
    "ics(p=67,n=3)",
    # match_pct_combined defaults (ICS 2.0-style: 67th percentile, L4+ anchor)
    "pl_decay(\u03c4=0.083,p=67,l4plus)",
    "bt_lvl_decay(scale=1.0,\u03c4=0.083,p=67,l4plus)",
}


def _print_results_table(results: list[TuneResult], top_n: int = 20) -> None:
    """Print a sorted table with the top results, highlighting defaults."""
    table = Table(
        title=f"Hyperparameter Sweep — Top {min(top_n, len(results))} Results",
        show_lines=True,
    )
    table.add_column("#", justify="right", style="dim", width=4)
    table.add_column("Configuration", style="cyan", no_wrap=True)
    table.add_column("Kendall \u03c4", justify="right")
    table.add_column("Top-5", justify="right")
    table.add_column("Top-10", justify="right")
    table.add_column("MRR", justify="right")
    table.add_column("Cons \u03c4", justify="right")
    table.add_column("Time", justify="right")

    # Find best values for bolding
    if not results:
        console.print("[red]No results to display.[/red]")
        return

    best_tau = max(r.metrics.get("kendall_tau", 0.0) for r in results)
    best_top5 = max(r.metrics.get("top_5_accuracy", 0.0) for r in results)
    best_top10 = max(r.metrics.get("top_10_accuracy", 0.0) for r in results)
    best_mrr = max(r.metrics.get("mrr", 0.0) for r in results)
    best_cons_tau = max(r.cons_metrics.get("kendall_tau", 0.0) for r in results)

    def _fmt(val: float, best: float, *, pct: bool = False) -> str:
        s = f"{val * 100:.1f}%" if pct else f"{val:.4f}"
        if abs(val - best) < 1e-9:
            return f"[bold green]{s}[/bold green]"
        return s

    for rank, r in enumerate(results[:top_n], 1):
        label = r.config.label
        is_default = label in _DEFAULT_LABELS
        style = "on grey15" if is_default else ""
        marker = " *" if is_default else ""

        tau_v = r.metrics.get("kendall_tau", 0.0)
        top5_v = r.metrics.get("top_5_accuracy", 0.0)
        top10_v = r.metrics.get("top_10_accuracy", 0.0)
        mrr_v = r.metrics.get("mrr", 0.0)
        cons_tau_v = r.cons_metrics.get("kendall_tau", 0.0)

        table.add_row(
            str(rank),
            f"{label}{marker}",
            _fmt(tau_v, best_tau),
            _fmt(top5_v, best_top5, pct=True),
            _fmt(top10_v, best_top10, pct=True),
            _fmt(mrr_v, best_mrr),
            _fmt(cons_tau_v, best_cons_tau),
            f"{r.elapsed_s:.1f}s",
            style=style,
        )

    console.print()
    console.print(table)
    console.print("[dim]* = current default parameters[/dim]")


def load_results(path: Path) -> list[TuneResult]:
    """Load TuneResult objects from a previously saved JSON file.

    This is the inverse of the JSON block written at the end of run_sweep.
    It is used by merge_results to combine runs from different machines or
    different scoring modes into a single analysis.
    """
    raw = json.loads(path.read_text())
    results: list[TuneResult] = []
    for r in raw.get("results", []):
        config = TuneConfig(
            algo_class=r["algo_class"],
            params=r["params"],
            label=r["label"],
            scoring_params=r.get("scoring_params", {}),
        )
        results.append(
            TuneResult(
                config=config,
                scoring=r["scoring"],
                metrics=r["metrics"],
                cons_metrics=r["cons_metrics"],
                elapsed_s=r.get("elapsed_s", 0.0),
            )
        )
    return results


def merge_results(paths: list[Path], top_n: int = 30) -> list[TuneResult]:
    """Load, de-duplicate, and display results from multiple tune JSON files.

    Intended for combining runs across scoring modes or across machines.
    Each result is uniquely identified by (label, scoring) — later files
    take precedence over earlier ones if the same config appears twice.

    The printed table includes a Scoring column so cross-mode comparisons
    are immediately visible. Results are sorted by Kendall tau descending
    within each scoring group, then the groups are interleaved by rank so
    the best configs from every mode appear near the top.

    Args:
        paths: Paths to tune_results.json files to merge (order matters for
               de-duplication precedence).
        top_n: Number of rows to show in the printed table.

    Returns:
        The full merged and sorted result list.
    """
    # De-duplicate: (label, scoring) → TuneResult; later file wins.
    seen: dict[tuple[str, str], TuneResult] = {}
    for path in paths:
        for r in load_results(path):
            seen[(r.config.label, r.scoring)] = r

    if not seen:
        console.print("[red]No results found in the provided files.[/red]")
        return []

    all_results = list(seen.values())

    # Print summary of what was loaded.
    scoring_counts: dict[str, int] = {}
    for r in all_results:
        scoring_counts[r.scoring] = scoring_counts.get(r.scoring, 0) + 1
    console.print(f"\n[bold]Merged Tuning Results[/bold]  ({len(all_results)} configurations)")
    for scoring_mode, count in sorted(scoring_counts.items()):
        console.print(f"  {scoring_mode}: {count} configs")

    # Print combined table (sorted by Kendall tau, with Scoring column).
    _print_merged_table(all_results, top_n=top_n)

    return all_results


def _print_merged_table(results: list[TuneResult], top_n: int = 30) -> None:
    """Print a combined table for results from multiple scoring modes."""
    sorted_results = sorted(
        results, key=lambda r: r.metrics.get("kendall_tau", 0.0), reverse=True
    )

    table = Table(
        title=f"Merged Hyperparameter Results — Top {min(top_n, len(sorted_results))}",
        show_lines=True,
    )
    table.add_column("#", justify="right", style="dim", width=4)
    table.add_column("Scoring", style="yellow", no_wrap=True, width=10)
    table.add_column("Configuration", style="cyan", no_wrap=True)
    table.add_column("Kendall τ", justify="right")
    table.add_column("Top-5", justify="right")
    table.add_column("Top-10", justify="right")
    table.add_column("MRR", justify="right")
    table.add_column("Cons τ", justify="right")

    if not sorted_results:
        console.print("[red]No results to display.[/red]")
        return

    best_tau = max(r.metrics.get("kendall_tau", 0.0) for r in sorted_results)
    best_top5 = max(r.metrics.get("top_5_accuracy", 0.0) for r in sorted_results)
    best_top10 = max(r.metrics.get("top_10_accuracy", 0.0) for r in sorted_results)
    best_mrr = max(r.metrics.get("mrr", 0.0) for r in sorted_results)
    best_cons_tau = max(r.cons_metrics.get("kendall_tau", 0.0) for r in sorted_results)

    def _fmt(val: float, best: float, *, pct: bool = False) -> str:
        s = f"{val * 100:.1f}%" if pct else f"{val:.4f}"
        if abs(val - best) < 1e-9:
            return f"[bold green]{s}[/bold green]"
        return s

    # Short labels for scoring mode column.
    _scoring_short = {
        "match_pct": "match%",
        "match_pct_combined": "combined",
        "stage_hf": "stage_hf",
    }

    for rank, r in enumerate(sorted_results[:top_n], 1):
        label = r.config.label
        is_default = label in _DEFAULT_LABELS
        style = "on grey15" if is_default else ""
        marker = " *" if is_default else ""
        scoring_label = _scoring_short.get(r.scoring, r.scoring)

        table.add_row(
            str(rank),
            scoring_label,
            f"{label}{marker}",
            _fmt(r.metrics.get("kendall_tau", 0.0), best_tau),
            _fmt(r.metrics.get("top_5_accuracy", 0.0), best_top5, pct=True),
            _fmt(r.metrics.get("top_10_accuracy", 0.0), best_top10, pct=True),
            _fmt(r.metrics.get("mrr", 0.0), best_mrr),
            _fmt(r.cons_metrics.get("kendall_tau", 0.0), best_cons_tau),
            style=style,
        )

    console.print()
    console.print(table)
    console.print("[dim]* = current default parameters[/dim]")


def run_sweep(
    db_path: Path,
    scoring: str = "match_pct",
    split_ratio: float = 0.7,
    workers: int | None = None,
    cons_z: float = _CONS_Z_DEFAULT,
    output_path: Path | None = None,
) -> list[TuneResult]:
    """Run the full hyperparameter grid search.

    Returns results sorted by Kendall tau (descending).
    """
    import os
    from concurrent.futures import ProcessPoolExecutor, as_completed

    from rich.progress import Progress

    from src.data.store import Store

    # Determine worker count
    if workers is None:
        cores = os.cpu_count() or 1
        effective_workers = max(1, min(cores - 1, 8))
    else:
        effective_workers = max(1, workers)

    # Load matches and split
    store = Store(db_path, read_only=True)
    try:
        all_matches = store.get_matches_chronological()
        skip_set = store.get_dedup_skip_set()
    finally:
        store.close()

    if not all_matches:
        console.print("[red]No matches in store. Run sync first.[/red]")
        return []

    # Filter out dedup-skipped matches
    filtered_matches = [
        m for m in all_matches if (m[0], m[1], m[2]) not in skip_set
    ]

    split_idx = int(len(filtered_matches) * split_ratio)
    train_matches = filtered_matches[:split_idx]
    test_matches = filtered_matches[split_idx:]
    test_match_keys = [(s, ct, mid) for s, ct, mid, _d, _l in test_matches]

    console.print(f"[bold]Hyperparameter Sweep[/bold]  scoring={scoring}")
    console.print(
        f"  Total: {len(all_matches)} matches "
        f"({len(all_matches) - len(filtered_matches)} dedup-skipped)"
    )
    console.print(f"  Train: {len(train_matches)} | Test: {len(test_matches)}")
    console.print(f"  Workers: {effective_workers}")

    configs = get_search_space(scoring)
    console.print(f"  Configurations: {len(configs)}")

    results: list[TuneResult] = []

    with Progress(console=console) as progress:
        task = progress.add_task("Evaluating configs...", total=len(configs))

        with ProcessPoolExecutor(max_workers=effective_workers) as executor:
            futures = {
                executor.submit(
                    _evaluate_config,
                    config,
                    db_path,
                    train_matches,
                    test_match_keys,
                    scoring,
                    cons_z,
                ): config
                for config in configs
            }

            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                progress.advance(task)

    # Sort by Kendall tau descending
    results.sort(key=lambda r: r.metrics.get("kendall_tau", 0.0), reverse=True)

    # Compute data quality
    data_quality = _compute_data_quality(
        db_path, all_matches, train_matches, test_matches, test_match_keys
    )

    # Save to JSON — default filename encodes the scoring mode so multiple
    # runs can coexist without overwriting each other.
    if output_path is None:
        output_path = Path(f"data/tune_results_{scoring}.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output = {
        "timestamp": datetime.now(UTC).isoformat(),
        "scoring": scoring,
        "split_ratio": split_ratio,
        "train_matches": len(train_matches),
        "test_matches": len(test_matches),
        "cons_z": cons_z,
        "data_quality": asdict(data_quality),
        "results": [
            {
                "label": r.config.label,
                "algo_class": r.config.algo_class,
                "params": r.config.params,
                "scoring_params": r.config.scoring_params,
                "scoring": r.scoring,
                "elapsed_s": round(r.elapsed_s, 2),
                "metrics": {k: round(v, 6) for k, v in r.metrics.items()},
                "cons_metrics": {k: round(v, 6) for k, v in r.cons_metrics.items()},
            }
            for r in results
        ],
    }
    output_path.write_text(json.dumps(output, indent=2))
    console.print(f"\n[green]Results saved to {output_path}[/green]")

    # Print table
    _print_results_table(results)

    return results
