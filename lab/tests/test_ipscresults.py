"""Tests for ipscresults.org OData client and syncer."""

from pathlib import Path
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

def _make_raw_bundle(
    *,
    competitors: list[dict] | None = None,
    results: list[dict] | None = None,
) -> dict:
    """Return a minimal raw OData bundle in the RawMatchStore format."""
    if competitors is None:
        competitors = [
            {"ID": 10, "Name": "Hollertz, Martin", "RegionCode": "SWE",
             "Division": "Production", "DivisionCode": 1, "DQ": False},
            {"ID": 11, "Name": "Jones, Bob", "RegionCode": "NOR",
             "Division": "Production", "DivisionCode": 1, "DQ": False},
        ]
    if results is None:
        results = [
            # Stage 1
            {"Rank": 1, "CompetitorNumber": 10, "CompetitorName": "Hollertz, Martin",
             "Region": "SWE", "StageNumber": 1,
             "HitFactor": 6.0, "Score": 150, "StageTime": 25.0,
             "StagePoints": 100.0, "StagePercent": 100.0},
            {"Rank": 2, "CompetitorNumber": 11, "CompetitorName": "Jones, Bob",
             "Region": "NOR", "StageNumber": 1,
             "HitFactor": 3.0, "Score": 75, "StageTime": 25.0,
             "StagePoints": 50.0, "StagePercent": 50.0},
            # Stage 2
            {"Rank": 1, "CompetitorNumber": 11, "CompetitorName": "Jones, Bob",
             "Region": "NOR", "StageNumber": 2,
             "HitFactor": 5.0, "Score": 120, "StageTime": 24.0,
             "StagePoints": 100.0, "StagePercent": 100.0},
            {"Rank": 2, "CompetitorNumber": 10, "CompetitorName": "Hollertz, Martin",
             "Region": "SWE", "StageNumber": 2,
             "HitFactor": 2.5, "Score": 60, "StageTime": 24.0,
             "StagePoints": 50.0, "StagePercent": 50.0},
        ]
    return {
        "schema_version": 1,
        "match_id": "uuid-1",
        "fetched_at": "2025-06-15T00:00:00+00:00",
        "competitors": competitors,
        "divisions": [{"DivisionCode": 1, "Division": "Production", "Total": 2}],
        "per_division": {
            "1": {
                "stages": [
                    {"ID": 1, "Name": "Stage 1", "MaxPoints": 150, "MinRounds": 30},
                    {"ID": 2, "Name": "Stage 2", "MaxPoints": 120, "MinRounds": 24},
                ],
                "results": results,
            }
        },
    }


@pytest.fixture
def mock_client() -> MagicMock:
    client = MagicMock()
    client.fetch_raw_bundle.return_value = _make_raw_bundle()
    return client


@pytest.fixture
def mock_store() -> MagicMock:
    return MagicMock()


def _fetch_match(mock_client: MagicMock) -> object:
    """Helper: call _fetch_match and return just the MatchResults (not the source tag)."""
    from src.data.ipscresults_models import IpscMatch

    syncer = IpscResultsSyncer(client=mock_client, store=MagicMock())
    m = IpscMatch(id="uuid-1", name="Nordic Open 2025", date="2025-06-15",
                  level=3, discipline="Handgun")
    results, _src = syncer._fetch_match(m)
    return results


def test_fetch_match_returns_match_results(mock_client: MagicMock) -> None:
    results = _fetch_match(mock_client)
    assert results is not None


def test_fetch_match_source_tag_api(mock_client: MagicMock) -> None:
    """Without a raw_store the bundle always comes from the API."""
    from src.data.ipscresults_models import IpscMatch

    syncer = IpscResultsSyncer(client=mock_client, store=MagicMock())
    m = IpscMatch(id="uuid-1", name="Nordic Open 2025", date="2025-06-15",
                  level=3, discipline="Handgun")
    _results, src = syncer._fetch_match(m)
    assert src == "api"


def test_fetch_match_source_tag_local(mock_client: MagicMock, tmp_path: Path) -> None:
    """When the bundle is already in the local raw store, source should be 'local'."""
    from src.data.ipscresults_models import IpscMatch
    from src.data.raw_store import RawMatchStore

    raw_store = RawMatchStore(tmp_path / "raw")
    raw_store.save("uuid-1", _make_raw_bundle())

    syncer = IpscResultsSyncer(client=mock_client, store=MagicMock(), raw_store=raw_store)
    m = IpscMatch(id="uuid-1", name="Nordic Open 2025", date="2025-06-15",
                  level=3, discipline="Handgun")
    _results, src = syncer._fetch_match(m)
    assert src == "local"
    mock_client.fetch_raw_bundle.assert_not_called()


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
    mock_client.fetch_raw_bundle.return_value = _make_raw_bundle(
        competitors=[
            {"ID": 10, "Name": "Hollertz, Martin", "RegionCode": "SWE",
             "Division": "Production", "DivisionCode": 1, "DQ": True},
            {"ID": 11, "Name": "Jones, Bob", "RegionCode": "NOR",
             "Division": "Production", "DivisionCode": 1, "DQ": False},
        ]
    )
    results = _fetch_match(mock_client)
    assert results is not None
    dq_results = [r for r in results.results if r.competitor_id == 10]
    assert all(r.dq for r in dq_results)
    ok_results = [r for r in results.results if r.competitor_id == 11]
    assert all(not r.dq for r in ok_results)


def test_fetch_match_zeroed_detection(mock_client: MagicMock) -> None:
    """A zero hit_factor + zero time should be marked as zeroed."""
    mock_client.fetch_raw_bundle.return_value = _make_raw_bundle(
        results=[
            {"Rank": 1, "CompetitorNumber": 10, "CompetitorName": "Hollertz, Martin",
             "Region": "SWE", "StageNumber": 1,
             "HitFactor": 0.0, "Score": 0, "StageTime": 0.0,
             "StagePoints": 0.0, "StagePercent": 0.0},
            {"Rank": 2, "CompetitorNumber": 11, "CompetitorName": "Jones, Bob",
             "Region": "NOR", "StageNumber": 1,
             "HitFactor": 0.0, "Score": 0, "StageTime": 5.0,
             "StagePoints": 0.0, "StagePercent": 0.0},
        ]
    )
    results = _fetch_match(mock_client)
    assert results is not None
    by_comp = {r.competitor_id: r for r in results.results}
    assert by_comp[10].zeroed is True   # both zero
    assert by_comp[11].zeroed is False  # has time → not a zero stage


def test_fetch_match_returns_none_when_no_divisions(mock_client: MagicMock) -> None:
    mock_client.fetch_raw_bundle.return_value = None
    results = _fetch_match(mock_client)
    assert results is None


def test_fetch_match_source_tag_api_on_none(mock_client: MagicMock) -> None:
    """When the API returns nothing, source should still be 'api'."""
    from src.data.ipscresults_models import IpscMatch

    mock_client.fetch_raw_bundle.return_value = None
    syncer = IpscResultsSyncer(client=mock_client, store=MagicMock())
    m = IpscMatch(id="uuid-1", name="Nordic Open 2025", date="2025-06-15",
                  level=3, discipline="Handgun")
    results, src = syncer._fetch_match(m)
    assert results is None
    assert src == "api"


# ------------------------------------------------------------------
# Level mapping
# ------------------------------------------------------------------

def test_level_map_l3_l4_l5() -> None:
    from src.data.ipscresults import _LEVEL_MAP
    assert _LEVEL_MAP[3] == "l3"
    assert _LEVEL_MAP[4] == "l4"
    assert _LEVEL_MAP[5] == "l5"
    assert 2 not in _LEVEL_MAP
