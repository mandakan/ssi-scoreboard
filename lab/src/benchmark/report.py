"""Benchmark report — rich tables and matplotlib charts."""

from __future__ import annotations

from rich.console import Console
from rich.table import Table

console = Console()


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def print_report(algo_metrics: dict[str, dict[str, list[float]]]) -> None:
    """Print a rich table summarizing benchmark results."""
    if not algo_metrics:
        console.print("[red]No results to report.[/red]")
        return

    table = Table(title="Benchmark Results", show_lines=True)
    table.add_column("Algorithm", style="cyan", no_wrap=True)
    table.add_column("Kendall τ", justify="right")
    table.add_column("Top-5 Acc", justify="right")
    table.add_column("Top-10 Acc", justify="right")
    table.add_column("MRR", justify="right")
    table.add_column("N matches", justify="right")

    for algo_name, metrics in algo_metrics.items():
        n = len(metrics.get("kendall_tau", []))
        table.add_row(
            algo_name,
            f"{_mean(metrics.get('kendall_tau', [])):.4f}",
            f"{_mean(metrics.get('top_5_accuracy', [])) * 100:.1f}%",
            f"{_mean(metrics.get('top_10_accuracy', [])) * 100:.1f}%",
            f"{_mean(metrics.get('mrr', [])):.4f}",
            str(n),
        )

    console.print()
    console.print(table)


def save_chart(
    algo_metrics: dict[str, dict[str, list[float]]],
    output_path: str = "data/benchmark.png",
) -> None:
    """Save a matplotlib comparison chart."""
    import matplotlib.pyplot as plt

    if not algo_metrics:
        return

    metric_names = ["kendall_tau", "top_5_accuracy", "top_10_accuracy", "mrr"]
    display_names = ["Kendall τ", "Top-5 Accuracy", "Top-10 Accuracy", "MRR"]
    algo_names = list(algo_metrics.keys())

    fig, axes = plt.subplots(1, len(metric_names), figsize=(4 * len(metric_names), 5))
    if len(metric_names) == 1:
        axes = [axes]

    for ax, metric, display in zip(axes, metric_names, display_names, strict=True):
        means = [_mean(algo_metrics[a].get(metric, [])) for a in algo_names]
        bars = ax.bar(algo_names, means)
        ax.set_title(display)
        ax.set_ylim(0, max(1.0, max(means) * 1.1) if means else 1.0)

        for bar, val in zip(bars, means, strict=True):
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                bar.get_height() + 0.01,
                f"{val:.3f}",
                ha="center",
                va="bottom",
                fontsize=9,
            )

    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    console.print(f"[green]Chart saved to {output_path}[/green]")
