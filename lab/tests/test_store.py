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


def _make_results(
    ct: int = 22,
    match_id: str = "100",
    source: str = "ssi",
) -> MatchResults:
    return MatchResults(
        meta=MatchResultsMeta(ct=ct, match_id=match_id, name="Test Match", source=source),
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
    assert not store.has_match("ssi", 22, "100")

    store.store_match_results(_make_results())

    assert store.get_match_count() == 1
    assert store.has_match("ssi", 22, "100")


def test_source_isolation(store: Store) -> None:
    """Same ct/match_id under different sources are distinct rows."""
    store.store_match_results(_make_results(source="ssi"))
    store.store_match_results(_make_results(source="ipscresults"))

    assert store.get_match_count() == 2
    assert store.has_match("ssi", 22, "100")
    assert store.has_match("ipscresults", 22, "100")
    assert not store.has_match("other", 22, "100")


def test_sync_watermark(store: Store) -> None:
    assert store.get_sync_watermark() is None
    assert store.get_sync_watermark(source="ssi") is None
    assert store.get_sync_watermark(source="ipscresults") is None

    store.set_sync_watermark("2026-01-01", source="ssi")
    store.set_sync_watermark("2025-06-01", source="ipscresults")

    assert store.get_sync_watermark(source="ssi") == "2026-01-01"
    assert store.get_sync_watermark(source="ipscresults") == "2025-06-01"

    # Update one, the other should be unchanged
    store.set_sync_watermark("2026-02-01", source="ssi")
    assert store.get_sync_watermark(source="ssi") == "2026-02-01"
    assert store.get_sync_watermark(source="ipscresults") == "2025-06-01"


def test_matches_chronological_all_sources(store: Store) -> None:
    r1 = _make_results(match_id="100", source="ssi")
    r1.meta.date = "2026-01-01"
    r2 = _make_results(match_id="200", source="ipscresults")
    r2.meta.date = "2026-02-01"

    store.store_match_results(r2)
    store.store_match_results(r1)

    matches = store.get_matches_chronological()
    assert len(matches) == 2
    # Sorted by date ascending
    assert matches[0][0] == "ssi"
    assert matches[0][2] == "100"
    assert matches[0][3] is not None and matches[0][3].startswith("2026-01-01")
    assert matches[1][0] == "ipscresults"
    assert matches[1][2] == "200"


def test_matches_chronological_filter_by_source(store: Store) -> None:
    r1 = _make_results(match_id="100", source="ssi")
    r1.meta.date = "2026-01-01"
    r2 = _make_results(match_id="200", source="ipscresults")
    r2.meta.date = "2026-02-01"

    store.store_match_results(r1)
    store.store_match_results(r2)

    ssi_matches = store.get_matches_chronological(source="ssi")
    assert len(ssi_matches) == 1
    assert ssi_matches[0][0] == "ssi"

    ipr_matches = store.get_matches_chronological(source="ipscresults")
    assert len(ipr_matches) == 1
    assert ipr_matches[0][0] == "ipscresults"


def test_competitor_shooter_map(store: Store) -> None:
    store.store_match_results(_make_results())
    comp_map = store.get_competitor_shooter_map("ssi", 22, "100")
    assert comp_map[5] == 42
    assert comp_map[6] == 43


def test_stage_results_for_match(store: Store) -> None:
    store.store_match_results(_make_results())
    results = store.get_stage_results_for_match("ssi", 22, "100")
    assert len(results) == 2
    hfs = {r[0]: r[2] for r in results}
    assert hfs[5] == 5.0
    assert hfs[6] == 3.0


def test_upsert_match(store: Store) -> None:
    store.store_match_results(_make_results())
    store.store_match_results(_make_results())
    assert store.get_match_count() == 1


# ------------------------------------------------------------------
# Identity resolution tables
# ------------------------------------------------------------------

def test_ensure_canonical_identity(store: Store) -> None:
    store.ensure_canonical_identity(42, "Alice Smith", "SWE")
    row = store.db.execute(
        "SELECT primary_name, region FROM shooter_identities WHERE canonical_id = 42"
    ).fetchone()
    assert row is not None
    assert row[0] == "Alice Smith"
    assert row[1] == "SWE"


def test_save_and_get_identity_link(store: Store) -> None:
    store.ensure_canonical_identity(42, "Alice Smith", "SWE")
    store.save_identity_link(
        source="ssi", source_key="42",
        canonical_id=42, name_variant="Alice Smith",
        confidence=1.0, method="auto_exact",
    )
    assert store.get_identity_link("ssi", "42") == 42
    assert store.get_identity_link("ssi", "999") is None


def test_manual_identity_link_not_overwritten(store: Store) -> None:
    store.ensure_canonical_identity(42, "Alice Smith", "SWE")
    store.save_identity_link(
        source="ipscresults", source_key="alice smith|SWE",
        canonical_id=42, name_variant="Alice Smith",
        confidence=1.0, method="manual",
    )
    # Attempt to overwrite with auto_exact — should be ignored
    store.save_identity_link(
        source="ipscresults", source_key="alice smith|SWE",
        canonical_id=999, name_variant="Alice Smith",
        confidence=1.0, method="auto_exact",
    )
    assert store.get_identity_link("ipscresults", "alice smith|SWE") == 42


def test_next_canonical_id(store: Store) -> None:
    id1 = store._next_canonical_id()
    id2 = store._next_canonical_id()
    assert id1 == 2_000_000
    assert id2 == 2_000_001


def test_canonical_competitor_map_ssi(store: Store) -> None:
    """SSI competitors fall back to shooter_id when no identity link exists."""
    store.store_match_results(_make_results(source="ssi"))
    # Bootstrap identity link for shooter 42
    store.ensure_canonical_identity(42, "Alice", "SWE")
    store.save_identity_link("ssi", "42", 42, "Alice", 1.0, "auto_exact")

    cmap = store.get_canonical_competitor_map("ssi", 22, "100")
    # competitor 5 → shooter_id 42 (linked)
    assert cmap[5] == 42
    # competitor 6 → shooter_id 43 (not linked, falls back to shooter_id)
    assert cmap[6] == 43


def test_canonical_competitor_map_ipscresults(store: Store) -> None:
    """ipscresults competitors resolve via identity_key fingerprint link."""
    from src.data.identity import name_fingerprint

    results = _make_results(source="ipscresults")
    # Give competitors fingerprint identity_keys (as ipscresults.py would do)
    results.competitors[0].identity_key = name_fingerprint("Alice Smith", "SWE")
    results.competitors[0].shooter_id = None
    results.competitors[1].identity_key = name_fingerprint("Bob Jones", "NOR")
    results.competitors[1].shooter_id = None
    store.store_match_results(results)

    fp_alice = name_fingerprint("Alice Smith", "SWE")
    store.ensure_canonical_identity(42, "Alice Smith", "SWE")
    store.save_identity_link("ipscresults", fp_alice, 42, "Alice Smith", 1.0, "auto_exact")

    cmap = store.get_canonical_competitor_map("ipscresults", 22, "100")
    assert cmap[5] == 42          # linked
    assert cmap[6] is None        # unlinked ipscresults competitor


def test_get_unlinked_ipscresults_competitors(store: Store) -> None:
    from src.data.identity import name_fingerprint

    fp_alice = name_fingerprint("Alice Smith", "SWE")
    fp_bob = name_fingerprint("Bob Jones", "NOR")

    results = MatchResults(
        meta=MatchResultsMeta(ct=0, match_id="uuid-1", name="Test", source="ipscresults"),
        stages=[StageMeta(stage_id=1, stage_number=1, stage_name="S1", max_points=100)],
        competitors=[
            CompetitorMeta(competitor_id=5, shooter_id=None, identity_key=fp_alice,
                           name="Alice Smith", division="Production", region="SWE"),
            CompetitorMeta(competitor_id=6, shooter_id=None, identity_key=fp_bob,
                           name="Bob Jones", division="Standard", region="NOR"),
        ],
        results=[
            StageResult(competitor_id=5, stage_id=1, hit_factor=5.0, points=95,
                        time=19.0, max_points=100, overall_rank=1, overall_percent=100.0),
            StageResult(competitor_id=6, stage_id=1, hit_factor=3.0, points=80,
                        time=26.7, max_points=100, overall_rank=2, overall_percent=60.0),
        ],
    )
    store.store_match_results(results)

    unlinked = store.get_unlinked_ipscresults_competitors()
    names = [u[0] for u in unlinked]
    assert "Alice Smith" in names
    assert "Bob Jones" in names

    # Link Alice — she should disappear from the unlinked list
    store.ensure_canonical_identity(42, "Alice Smith", "SWE")
    store.save_identity_link("ipscresults", fp_alice, 42, "Alice Smith", 1.0, "auto_exact")

    unlinked_after = store.get_unlinked_ipscresults_competitors()
    names_after = [u[0] for u in unlinked_after]
    assert "Alice Smith" not in names_after
    assert "Bob Jones" in names_after


# ------------------------------------------------------------------
# Match deduplication tables
# ------------------------------------------------------------------

def test_save_match_link_and_skip_set(store: Store) -> None:
    store.save_match_link(
        source_a="ssi", ct_a=22, match_id_a="100",
        source_b="ipscresults", ct_b=0, match_id_b="uuid-abc",
        confidence=0.90, method="auto_name_date", preferred="a",
    )
    assert store.get_match_links_count() == 1

    skip = store.get_dedup_skip_set()
    # preferred='a' → skip the 'b' side
    assert ("ipscresults", 0, "uuid-abc") in skip
    assert ("ssi", 22, "100") not in skip


def test_dedup_skip_set_preferred_b(store: Store) -> None:
    store.save_match_link(
        source_a="ssi", ct_a=22, match_id_a="100",
        source_b="ipscresults", ct_b=0, match_id_b="uuid-abc",
        confidence=0.90, method="auto_name_date", preferred="b",
    )
    skip = store.get_dedup_skip_set()
    # preferred='b' → skip the 'a' side
    assert ("ssi", 22, "100") in skip
    assert ("ipscresults", 0, "uuid-abc") not in skip
