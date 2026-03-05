"""Tests for the DuckDB store."""

from pathlib import Path

import pytest

from src.data.models import (
    CompetitorMeta,
    MatchResults,
    MatchResultsMeta,
    StageMeta,
    StageResult,
)
from src.data.store import Store


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "test.duckdb")


def _make_results(ct: int = 22, match_id: str = "100") -> MatchResults:
    return MatchResults(
        meta=MatchResultsMeta(ct=ct, match_id=match_id, name="Test Match"),
        stages=[StageMeta(stage_id=1, stage_number=1, stage_name="Stage 1", max_points=100)],
        competitors=[
            CompetitorMeta(competitor_id=5, shooter_id=42, name="Alice", division="Production"),
            CompetitorMeta(competitor_id=6, shooter_id=43, name="Bob", division="Standard"),
        ],
        results=[
            StageResult(
                competitor_id=5, stage_id=1, hit_factor=5.0, points=95, time=19.0,
                max_points=100, overall_rank=1, overall_percent=100.0,
            ),
            StageResult(
                competitor_id=6, stage_id=1, hit_factor=3.0, points=80, time=26.7,
                max_points=100, overall_rank=2, overall_percent=60.0,
            ),
        ],
    )


def test_store_and_retrieve(store: Store) -> None:
    assert store.get_match_count() == 0
    assert not store.has_match(22, "100")

    store.store_match_results(_make_results())

    assert store.get_match_count() == 1
    assert store.has_match(22, "100")


def test_sync_watermark(store: Store) -> None:
    assert store.get_sync_watermark() is None
    store.set_sync_watermark("2026-01-01")
    assert store.get_sync_watermark() == "2026-01-01"
    store.set_sync_watermark("2026-02-01")
    assert store.get_sync_watermark() == "2026-02-01"


def test_matches_chronological(store: Store) -> None:
    r1 = _make_results(match_id="100")
    r1.meta.date = "2026-01-01"
    r2 = _make_results(match_id="200")
    r2.meta.date = "2026-02-01"

    store.store_match_results(r2)
    store.store_match_results(r1)

    matches = store.get_matches_chronological()
    assert len(matches) == 2
    assert matches[0][1] == "100"  # Earlier date first
    assert matches[1][1] == "200"


def test_competitor_shooter_map(store: Store) -> None:
    store.store_match_results(_make_results())
    comp_map = store.get_competitor_shooter_map(22, "100")
    assert comp_map[5] == 42
    assert comp_map[6] == 43


def test_stage_results_for_match(store: Store) -> None:
    store.store_match_results(_make_results())
    results = store.get_stage_results_for_match(22, "100")
    assert len(results) == 2
    # Results are (competitor_id, stage_id, hit_factor, dq, dnf, zeroed)
    hfs = {r[0]: r[2] for r in results}
    assert hfs[5] == 5.0
    assert hfs[6] == 3.0


def test_upsert_match(store: Store) -> None:
    store.store_match_results(_make_results())
    store.store_match_results(_make_results())
    assert store.get_match_count() == 1
