"""Tests for benchmark metrics."""

import pytest

from src.benchmark.metrics import kendall_tau, mean_reciprocal_rank, top_k_accuracy


def test_kendall_tau_perfect() -> None:
    actual = [1, 2, 3, 4, 5]
    predicted = [1, 2, 3, 4, 5]
    assert kendall_tau(predicted, actual) == pytest.approx(1.0)


def test_kendall_tau_reversed() -> None:
    actual = [1, 2, 3, 4, 5]
    predicted = [5, 4, 3, 2, 1]
    assert kendall_tau(predicted, actual) == pytest.approx(-1.0)


def test_kendall_tau_empty() -> None:
    assert kendall_tau([], []) == 0.0


def test_kendall_tau_single() -> None:
    assert kendall_tau([1], [1]) == 0.0


def test_top_k_accuracy_perfect() -> None:
    actual = [1, 2, 3, 4, 5]
    predicted = [1, 2, 3, 4, 5]
    assert top_k_accuracy(predicted, actual, k=3) == 1.0


def test_top_k_accuracy_none_match() -> None:
    actual = [1, 2, 3, 4, 5]
    predicted = [6, 7, 8, 9, 10]
    assert top_k_accuracy(predicted, actual, k=3) == 0.0


def test_top_k_accuracy_partial() -> None:
    actual = [1, 2, 3, 4, 5]
    predicted = [1, 6, 3, 7, 8]
    # Top-3 predicted: {1, 6, 3}, Top-3 actual: {1, 2, 3}, overlap = {1, 3}
    assert top_k_accuracy(predicted, actual, k=3) == 2.0 / 3.0


def test_mrr_perfect() -> None:
    predicted = [1, 2, 3, 4, 5]
    actual_top = [1]
    assert mean_reciprocal_rank(predicted, actual_top) == 1.0


def test_mrr_second() -> None:
    predicted = [2, 1, 3, 4, 5]
    actual_top = [1]
    assert mean_reciprocal_rank(predicted, actual_top) == 0.5


def test_mrr_empty() -> None:
    assert mean_reciprocal_rank([], [1]) == 0.0
    assert mean_reciprocal_rank([1], []) == 0.0
