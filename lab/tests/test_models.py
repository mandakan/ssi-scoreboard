"""Tests for Pydantic data models."""

from src.data.models import (
    CompetitorMeta,
    MatchMeta,
    MatchResults,
    MatchResultsMeta,
    Rating,
    StageMeta,
    StageResult,
)


def test_match_meta_defaults() -> None:
    m = MatchMeta(ct=22, match_id="123", name="Test Match")
    assert m.ct == 22
    assert m.date is None
    assert m.has_scorecards is False


def test_stage_result_defaults() -> None:
    r = StageResult(competitor_id=1, stage_id=1)
    assert r.hit_factor is None
    assert r.dq is False
    assert r.dnf is False


def test_match_results_round_trip() -> None:
    results = MatchResults(
        meta=MatchResultsMeta(ct=22, match_id="100", name="Test"),
        stages=[StageMeta(stage_id=1, stage_number=1, stage_name="Stage 1", max_points=100)],
        competitors=[
            CompetitorMeta(competitor_id=5, shooter_id=42, name="John", division="Production")
        ],
        results=[
            StageResult(
                competitor_id=5,
                stage_id=1,
                hit_factor=4.5,
                points=90,
                time=20.0,
                max_points=100,
                overall_rank=3,
                overall_percent=85.0,
            )
        ],
    )
    assert len(results.results) == 1
    assert results.results[0].hit_factor == 4.5
    assert results.meta.name == "Test"


def test_rating_model() -> None:
    r = Rating(shooter_id=42, name="Test Shooter", mu=25.0, sigma=8.333)
    assert r.matches_played == 0
    assert r.division is None
