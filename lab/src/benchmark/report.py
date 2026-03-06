"""Benchmark report — rich tables and matplotlib charts."""

from __future__ import annotations

from rich.console import Console
from rich.table import Table

console = Console()


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def print_report(algo_metrics: dict[str, dict[str, list[float]]]) -> None:
    """Print main benchmark results table.

    Rows are interleaved: each base algorithm is immediately followed by its
    conservative (+cons) variant so the effect of conservative ranking is easy
    to compare. Conservative rows are rendered in a dimmer style.
    """
    if not algo_metrics:
        console.print("[red]No results to report.[/red]")
        return

    table = Table(title="Benchmark Results", show_lines=True)
    table.add_column("Algorithm", style="cyan", no_wrap=True)
    table.add_column("Kendall τ", justify="right")
    table.add_column("Top-5 Acc", justify="right")
    table.add_column("Top-10 Acc", justify="right")
    table.add_column("MRR", justify="right")
    table.add_column("N", justify="right")

    # Find the best value for each metric column (across all rows) for bolding.
    tau_vals = [_mean(m.get("kendall_tau", [])) for m in algo_metrics.values()]
    top5_vals = [_mean(m.get("top_5_accuracy", [])) for m in algo_metrics.values()]
    top10_vals = [_mean(m.get("top_10_accuracy", [])) for m in algo_metrics.values()]
    mrr_vals = [_mean(m.get("mrr", [])) for m in algo_metrics.values()]
    best_tau = max(tau_vals) if tau_vals else 0.0
    best_top5 = max(top5_vals) if top5_vals else 0.0
    best_top10 = max(top10_vals) if top10_vals else 0.0
    best_mrr = max(mrr_vals) if mrr_vals else 0.0

    def _fmt(val: float, best: float, pct: bool = False) -> str:
        s = f"{val * 100:.1f}%" if pct else f"{val:.4f}"
        return f"[bold]{s}[/bold]" if abs(val - best) < 1e-9 else s

    for algo_name, metrics in algo_metrics.items():
        is_cons = algo_name.endswith("+cons")
        display = "  ↳ +cons" if is_cons else algo_name
        n = len(metrics.get("kendall_tau", []))
        tau = _mean(metrics.get("kendall_tau", []))
        top5 = _mean(metrics.get("top_5_accuracy", []))
        top10 = _mean(metrics.get("top_10_accuracy", []))
        mrr = _mean(metrics.get("mrr", []))

        row = [
            display,
            _fmt(tau, best_tau),
            _fmt(top5, best_top5, pct=True),
            _fmt(top10, best_top10, pct=True),
            _fmt(mrr, best_mrr),
            str(n),
        ]

        if is_cons:
            table.add_row(*row, style="dim")
        else:
            table.add_row(*row)

    console.print()
    console.print(table)


def print_division_report(
    division_taus: dict[str, dict[str, list[float]]],
    min_matches: int = 5,
) -> None:
    """Print per-division Kendall τ matrix.

    Rows are IPSC divisions. Columns are base algorithms (conservative variants
    excluded to keep the table width manageable). Shows how well each algorithm
    ranks competitors *within* each division — a proxy for cross-division fairness.

    Only divisions with at least min_matches data points for at least half the
    algorithms are shown.
    """
    if not division_taus:
        return

    algo_names = list(division_taus.keys())

    # Collect all divisions and their per-algo sample counts.
    all_divs: set[str] = set()
    for div_data in division_taus.values():
        all_divs.update(div_data.keys())

    # Filter: division must have >= min_matches in at least half the algorithms.
    threshold = max(1, len(algo_names) // 2)
    qualifying: list[str] = []
    for div in sorted(all_divs):
        rich_enough = sum(
            1 for a in algo_names if len(division_taus[a].get(div, [])) >= min_matches
        )
        if rich_enough >= threshold:
            qualifying.append(div)

    if not qualifying:
        console.print(
            f"\n[dim]No divisions with ≥{min_matches} test matches "
            f"for ≥{threshold} algorithms.[/dim]"
        )
        return

    # Sort divisions by total number of observations descending.
    qualifying.sort(
        key=lambda d: sum(len(division_taus[a].get(d, [])) for a in algo_names),
        reverse=True,
    )

    table = Table(
        title=f"Per-Division Kendall τ  (base ranking only, min {min_matches} matches per cell)",
        show_lines=True,
    )
    table.add_column("Division", style="cyan", no_wrap=True)
    table.add_column("N", justify="right")
    for a in algo_names:
        table.add_column(a, justify="right", no_wrap=True)

    for div in qualifying:
        means = [_mean(division_taus[a].get(div, [])) for a in algo_names]
        counts = [len(division_taus[a].get(div, [])) for a in algo_names]
        best_mean = max(means) if means else 0.0
        typical_n = max(counts) if counts else 0

        cells: list[str] = []
        for m, n in zip(means, counts, strict=True):
            if n < min_matches:
                cells.append("[dim]—[/dim]")
            elif abs(m - best_mean) < 1e-9:
                cells.append(f"[bold]{m:.4f}[/bold]")
            else:
                cells.append(f"{m:.4f}")

        table.add_row(div, str(typical_n), *cells)

    console.print()
    console.print(table)


def save_chart(
    algo_metrics: dict[str, dict[str, list[float]]],
    output_path: str = "data/benchmark.png",
) -> None:
    """Save a matplotlib comparison chart (base algorithms only, excluding +cons rows)."""
    import matplotlib.pyplot as plt

    # Exclude conservative variants from the chart to keep it readable.
    base_metrics = {k: v for k, v in algo_metrics.items() if not k.endswith("+cons")}
    if not base_metrics:
        return

    metric_names = ["kendall_tau", "top_5_accuracy", "top_10_accuracy", "mrr"]
    display_names = ["Kendall τ", "Top-5 Accuracy", "Top-10 Accuracy", "MRR"]
    algo_names = list(base_metrics.keys())

    fig, axes = plt.subplots(1, len(metric_names), figsize=(4 * len(metric_names), 5))
    if len(metric_names) == 1:
        axes = [axes]

    for ax, metric, display in zip(axes, metric_names, display_names, strict=True):
        means = [_mean(base_metrics[a].get(metric, [])) for a in algo_names]
        bars = ax.bar(algo_names, means)
        ax.set_title(display)
        ax.set_ylim(0, max(1.0, max(means) * 1.1) if means else 1.0)
        ax.set_xticklabels(algo_names, rotation=30, ha="right", fontsize=8)

        for bar, val in zip(bars, means, strict=True):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.01,
                f"{val:.3f}",
                ha="center",
                va="bottom",
                fontsize=8,
            )

    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    console.print(f"[green]Chart saved to {output_path}[/green]")
