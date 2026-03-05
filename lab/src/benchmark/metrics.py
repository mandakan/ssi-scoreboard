"""Benchmark metrics for evaluating rating algorithms."""

from __future__ import annotations

from scipy.stats import kendalltau


def kendall_tau(predicted: list[int], actual: list[int]) -> float:
    """Kendall's tau rank correlation between predicted and actual orderings.

    Both lists must contain the same set of IDs. Returns a value in [-1, 1]
    where 1 = perfect agreement, -1 = perfect disagreement, 0 = no correlation.
    """
    if len(predicted) < 2:
        return 0.0

    # Build rank arrays in the same order
    pred_rank = {sid: i for i, sid in enumerate(predicted)}
    actual_rank = {sid: i for i, sid in enumerate(actual)}

    common = sorted(set(predicted) & set(actual))
    if len(common) < 2:
        return 0.0

    pred_ranks = [pred_rank[sid] for sid in common]
    actual_ranks = [actual_rank[sid] for sid in common]

    tau: float
    tau, _ = kendalltau(pred_ranks, actual_ranks)
    return tau if tau == tau else 0.0  # NaN guard


def top_k_accuracy(predicted: list[int], actual: list[int], k: int = 5) -> float:
    """Fraction of the true top-k that appear in the predicted top-k.

    Returns a value in [0, 1]. If fewer than k competitors exist, uses all.
    """
    if not predicted or not actual:
        return 0.0
    effective_k = min(k, len(predicted), len(actual))
    pred_top = set(predicted[:effective_k])
    actual_top = set(actual[:effective_k])
    return len(pred_top & actual_top) / effective_k


def mean_reciprocal_rank(predicted: list[int], actual_top: list[int]) -> float:
    """Mean reciprocal rank: average of 1/rank for each actual top competitor.

    For each shooter in actual_top, find their position in the predicted list.
    MRR = mean(1/rank). Higher is better.
    """
    if not predicted or not actual_top:
        return 0.0

    pred_rank = {sid: i + 1 for i, sid in enumerate(predicted)}
    reciprocals = []
    for sid in actual_top:
        rank = pred_rank.get(sid)
        if rank is not None:
            reciprocals.append(1.0 / rank)
    return sum(reciprocals) / len(actual_top) if actual_top else 0.0
