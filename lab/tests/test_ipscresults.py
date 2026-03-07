"""Tests for ipscresults.org OData client and syncer."""

from unittest.mock import MagicMock

import pytest

from src.data.identity import name_fingerprint
from src.data.ipscresults import IpscResultsSyncer
from src.data.ipscresults_models import (
    IpscCompetitor,
    IpscDivision,
    IpscMatch,
    IpscStage,
    IpscStageResult,
)

# ------------------------------------------------------------------
# Model parsing
# ------------------------------------------------------------------

def test_ipsc_match_defaults() -> None:
    m = IpscMatch(id="uuid-1", name="Test Match")
    assert m.level == 0
    assert m.state == 0
    assert m.date is None
    assert m.region_name is None


def test_ipsc_competitor_dq_default() -> None:
    c = IpscCompetitor(
        id=1, name="Smith, Alice", division="Production", division_code=1
    )
    assert c.dq is False
    assert c.alias is None


def test_ipsc_stage_result_defaults() -> None:
    r = IpscStageResult(
        rank=1, competitor_number=1, competitor_name="Smith, Alice", stage_number=1
    )
    assert r.hit_factor == 0.0
    assert r.stage_time == 0.0
    assert r.score == 0


# ------------------------------------------------------------------
# IpscResultsSyncer._fetch_match
# ------------------------------------------------------------------

def _make_divisions() -> list[IpscDivision]:
    return [IpscDivision(division_code=1, division="Production", total=2)]


def _make_stages() -> list[IpscStage]:
    return [
        IpscStage(id=1, name="Stage 1", max_points=150, min_rounds=30),
        IpscStage(id=2, name="Stage 2", max_points=120, min_rounds=24),
    ]


def _make_stage_results() -> list[IpscStageResult]:
    return [
        # Stage 1
        IpscStageResult(rank=1, competitor_number=10, competitor_name="Hollertz, Martin",
                        region="SWE", stage_number=1, hit_factor=6.0, score=150,
                        stage_time=25.0, stage_points=100.0, stage_percent=100.0),
        IpscStageResult(rank=2, competitor_number=11, competitor_name="Jones, Bob",
                        region="NOR", stage_number=1, hit_factor=3.0, score=75,
                        stage_time=25.0, stage_points=50.0, stage_percent=50.0),
        # Stage 2
        IpscStageResult(rank=1, competitor_number=11, competitor_name="Jones, Bob",
                        region="NOR", stage_number=2, hit_factor=5.0, score=120,
                        stage_time=24.0, stage_points=100.0, stage_percent=100.0),
        IpscStageResult(rank=2, competitor_number=10, competitor_name="Hollertz, Martin",
                        region="SWE", stage_number=2, hit_factor=2.5, score=60,
                        stage_time=24.0, stage_points=50.0, stage_percent=50.0),
    ]


def _make_competitors() -> list[IpscCompetitor]:
    return [
        IpscCompetitor(id=10, name="Hollertz, Martin", region_code="SWE",
                       division="Production", division_code=1, dq=False),
        IpscCompetitor(id=11, name="Jones, Bob", region_code="NOR",
                       division="Production", division_code=1, dq=False),
    ]


@pytest.fixture
def mock_client() -> MagicMock:
    client = MagicMock()
    client.get_divisions.return_value = _make_divisions()
    client.get_stage_list.return_value = _make_stages()
    client.get_stage_results.return_value = _make_stage_results()
    client.get_competitors.return_value = _make_competitors()
    return client


@pytest.fixture
def mock_store() -> MagicMock:
    return MagicMock()


def _fetch_match(mock_client: MagicMock) -> object:
    """Helper to call _fetch_match with a minimal IpscMatch."""
    from src.data.ipscresults_models import IpscMatch

    syncer = IpscResultsSyncer(client=mock_client, store=MagicMock())
    m = IpscMatch(id="uuid-1", name="Nordic Open 2025", date="2025-06-15",
                  level=3, discipline="Handgun")
    return syncer._fetch_match(m)


def test_fetch_match_returns_match_results(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None


def test_fetch_match_source_is_ipscresults(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None
    assert results.meta.source == "ipscresults"
    assert results.meta.ct == 0


def test_fetch_match_level_mapping(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None
    assert results.meta.level == "l3"


def test_fetch_match_stage_count(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None
    assert len(results.stages) == 2


def test_fetch_match_competitor_count(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None
    assert len(results.competitors) == 2


def test_fetch_match_name_normalized(mock_client: MagicMock) -> None:
    """ipscresults 'Last, First' names should be converted to 'First Last'."""
    results = _fetch_match(mock_client)
    assert results is not None
    names = {c.name for c in results.competitors}
    assert "Martin Hollertz" in names
    assert "Bob Jones" in names
    # Should NOT contain "Hollertz, Martin" format
    assert all("," not in n for n in names)


def test_fetch_match_identity_key_is_fingerprint(mock_client: MagicMock) -> None:
    """Each competitor should have identity_key set to their name fingerprint."""
    results = _fetch_match(mock_client)
    assert results is not None
    keys = {c.identity_key for c in results.competitors}
    assert name_fingerprint("Martin Hollertz", "SWE") in keys
    assert name_fingerprint("Bob Jones", "NOR") in keys


def test_fetch_match_overall_percent_computed(mock_client: MagicMock) -> None:
    """Stage winner should have 100% overall_percent; runner-up less."""
    results = _fetch_match(mock_client)
    assert results is not None
    # Stage 1: winner is competitor 10 (HF 6.0), runner-up is 11 (HF 3.0 = 50%)
    stage1_results = [r for r in results.results if r.stage_id == 1]
    by_comp = {r.competitor_id: r for r in stage1_results}
    assert by_comp[10].overall_percent == pytest.approx(100.0)
    assert by_comp[11].overall_percent == pytest.approx(50.0)


def test_fetch_match_dq_propagated(mock_client: MagicMock) -> None:
    """DQ status from CompetitorList should propagate to stage results."""
    # Make competitor 10 DQ'd
    mock_client.get_competitors.return_value = [
        IpscCompetitor(id=10, name="Hollertz, Martin", region_code="SWE",
                       division="Production", division_code=1, dq=True),
        IpscCompetitor(id=11, name="Jones, Bob", region_code="NOR",
                       division="Production", division_code=1, dq=False),
    ]
    results = _fetch_match(mock_client)
    assert results is not None
    dq_results = [r for r in results.results if r.competitor_id == 10]
    assert all(r.dq for r in dq_results)
    ok_results = [r for r in results.results if r.competitor_id == 11]
    assert all(not r.dq for r in ok_results)


def test_fetch_match_zeroed_detection(mock_client: MagicMock) -> None:
    """A zero hit_factor + zero time should be marked as zeroed."""
    mock_client.get_stage_results.return_value = [
        IpscStageResult(rank=1, competitor_number=10, competitor_name="Hollertz, Martin",
                        region="SWE", stage_number=1, hit_factor=0.0, score=0,
                        stage_time=0.0, stage_points=0.0, stage_percent=0.0),
        IpscStageResult(rank=2, competitor_number=11, competitor_name="Jones, Bob",
                        region="NOR", stage_number=1, hit_factor=0.0, score=0,
                        stage_time=5.0, stage_points=0.0, stage_percent=0.0),
    ]
    results = _fetch_match(mock_client)
    assert results is not None
    by_comp = {r.competitor_id: r for r in results.results}
    assert by_comp[10].zeroed is True   # both zero
    assert by_comp[11].zeroed is False  # has time → not a zero stage


def test_fetch_match_returns_none_when_no_divisions(mock_client: MagicMock) -> None:
    mock_client.get_divisions.return_value = []
    results = _fetch_match(mock_client)
    assert results is None


# ------------------------------------------------------------------
# Level mapping
# ------------------------------------------------------------------

def test_level_map_l3_l4_l5() -> None:
    from src.data.ipscresults import _LEVEL_MAP
    assert _LEVEL_MAP[3] == "l3"
    assert _LEVEL_MAP[4] == "l4"
    assert _LEVEL_MAP[5] == "l5"
    assert 2 not in _LEVEL_MAP
