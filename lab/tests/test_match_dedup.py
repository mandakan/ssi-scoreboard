"""Tests for match deduplication logic."""

from pathlib import Path

import pytest

from src.data.match_dedup import (
    _date_proximity,
    _name_similarity,
    _normalize_match_name,
    apply_dedup,
    find_duplicate_matches,
)
from src.data.models import (
    CompetitorMeta,
    MatchResults,
    MatchResultsMeta,
    StageMeta,
    StageResult,
)
from src.data.store import Store

# ------------------------------------------------------------------
# Pure helpers
# ------------------------------------------------------------------

def test_normalize_match_name_removes_stop_words() -> None:
    assert _normalize_match_name("IPSC Handgun Championship 2025") == "ipsc 2025"
    assert _normalize_match_name("Nordic Open Cup") == "nordic"
    assert _normalize_match_name("Swedish Match") == "swedish"


def test_normalize_match_name_strips_punctuation() -> None:
    result = _normalize_match_name("Test-Match 2025!")
    assert "!" not in result
    assert "-" not in result


def test_normalize_match_name_handles_diacritics() -> None:
    result = _normalize_match_name("Örebro Open")
    assert "Ö" not in result
    assert "orebro" in result


def test_date_proximity_within_window() -> None:
    assert _date_proximity("2025-06-01", "2025-06-03", max_days=3) is True
    assert _date_proximity("2025-06-01", "2025-06-04", max_days=3) is True   # exactly 3 days
    assert _date_proximity("2025-06-01", "2025-06-05", max_days=3) is False  # 4 days — outside
    assert _date_proximity("2025-06-01", "2025-05-29", max_days=3) is True


def test_date_proximity_exact_same_date() -> None:
    assert _date_proximity("2025-06-01", "2025-06-01") is True


def test_date_proximity_none_dates() -> None:
    assert _date_proximity(None, "2025-06-01") is False
    assert _date_proximity("2025-06-01", None) is False
    assert _date_proximity(None, None) is False


def test_date_proximity_accepts_datetime_prefix() -> None:
    # Handles ISO datetime strings (not just date strings)
    assert _date_proximity("2025-06-01T00:00:00", "2025-06-01") is True


def test_name_similarity_identical() -> None:
    assert _name_similarity("Nordic Open 2025", "Nordic Open 2025") == 1.0


def test_name_similarity_high_for_same_match() -> None:
    # Same match, minor formatting differences
    sim = _name_similarity("Nordic Open 2025", "Nordic Open Championship 2025")
    assert sim > 0.80


def test_name_similarity_low_for_different_matches() -> None:
    sim = _name_similarity("Swedish Cup 2025", "Norwegian Championship 2024")
    assert sim < 0.80


# ------------------------------------------------------------------
# find_duplicate_matches integration
# ------------------------------------------------------------------

@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "test.duckdb")


def _make_match(
    source: str,
    match_id: str,
    name: str,
    date: str,
    n_stages: int = 5,
    n_competitors: int = 10,
) -> MatchResults:
    competitors = [
        CompetitorMeta(
            competitor_id=i,
            shooter_id=i if source == "ssi" else None,
            name=f"Shooter {i}",
            division="Production",
        )
        for i in range(n_competitors)
    ]
    stages = [
        StageMeta(stage_id=j, stage_number=j, stage_name=f"S{j}", max_points=100)
        for j in range(1, n_stages + 1)
    ]
    results = [
        StageResult(
            competitor_id=i, stage_id=j,
            hit_factor=1.0, points=50, time=50.0, max_points=100,
            overall_rank=1, overall_percent=100.0,
        )
        for i in range(n_competitors)
        for j in range(1, n_stages + 1)
    ]
    return MatchResults(
        meta=MatchResultsMeta(ct=22 if source == "ssi" else 0,
                              match_id=match_id, name=name, date=date, source=source),
        stages=stages,
        competitors=competitors,
        results=results,
    )


def test_find_duplicate_same_name_and_date(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-15")
    )

    dupes = find_duplicate_matches(store)
    assert len(dupes) == 1
    assert dupes[0].source_a in ("ssi", "ipscresults")
    assert dupes[0].source_b in ("ssi", "ipscresults")
    assert dupes[0].source_a != dupes[0].source_b


def test_find_duplicate_date_within_window(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-17")
    )

    dupes = find_duplicate_matches(store, date_window=3)
    assert len(dupes) == 1


def test_find_no_duplicate_date_outside_window(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-22")
    )

    dupes = find_duplicate_matches(store, date_window=3)
    assert len(dupes) == 0


def test_find_no_duplicate_different_name(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Swedish Championship 2025", "2025-06-15")
    )

    dupes = find_duplicate_matches(store, date_window=3)
    assert len(dupes) == 0


def test_no_duplicate_within_same_source(store: Store) -> None:
    """Matches from the same source are never considered duplicates."""
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ssi", "101", "Nordic Open 2025", "2025-06-15")
    )

    dupes = find_duplicate_matches(store)
    assert len(dupes) == 0


def test_already_linked_pairs_are_skipped(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-15")
    )

    # Pre-link the pair
    store.save_match_link(
        "ssi", 22, "100", "ipscresults", 0, "uuid-abc",
        confidence=0.9, method="manual", preferred="a",
    )

    dupes = find_duplicate_matches(store)
    assert len(dupes) == 0


def test_preferred_source_more_stages_wins(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15", n_stages=10)
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-15", n_stages=5)
    )

    dupes = find_duplicate_matches(store)
    assert len(dupes) == 1
    d = dupes[0]
    # The preferred side should be the one with more stages (SSI = 10 stages)
    if d.source_a == "ssi":
        assert d.preferred == "a"
    else:
        assert d.preferred == "b"


def test_apply_dedup_persists_links(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-15")
    )

    dupes = find_duplicate_matches(store)
    n = apply_dedup(store, dupes)

    assert n == 1
    assert store.get_match_links_count() == 1


def test_dedup_skip_set_excludes_non_preferred(store: Store) -> None:
    store.store_match_results(
        _make_match("ssi", "100", "Nordic Open 2025", "2025-06-15")
    )
    store.store_match_results(
        _make_match("ipscresults", "uuid-abc", "Nordic Open 2025", "2025-06-15")
    )

    dupes = find_duplicate_matches(store)
    apply_dedup(store, dupes)

    skip = store.get_dedup_skip_set()
    assert len(skip) == 1
    # The skipped side is exactly one (source, ct, match_id) tuple
    (skipped_source, _, _) = next(iter(skip))
    assert skipped_source in ("ssi", "ipscresults")
