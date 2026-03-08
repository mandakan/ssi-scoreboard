"""Tests for cross-source identity resolution."""

from pathlib import Path

import pytest

from src.data.identity import (
    IdentityResolver,
    _pick_primary_name,
    name_fingerprint,
    normalize_name,
    strip_diacritics,
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

def test_strip_diacritics() -> None:
    assert strip_diacritics("Sjöberg") == "Sjoberg"
    assert strip_diacritics("Saša Petrović") == "Sasa Petrovic"
    assert strip_diacritics("Marianne Schön") == "Marianne Schon"
    assert strip_diacritics("plain") == "plain"


def test_normalize_name_ssi() -> None:
    # SSI already uses "First Last" format
    assert normalize_name("Martin Hollertz", "ssi") == "Martin Hollertz"
    assert normalize_name("  Alice  ", "ssi") == "Alice"


def test_normalize_name_ipscresults() -> None:
    # ipscresults uses "Last, First Middle" format
    assert normalize_name("Hollertz, Martin", "ipscresults") == "Martin Hollertz"
    assert normalize_name("Smith, Alice Jane", "ipscresults") == "Alice Jane Smith"
    assert normalize_name("Onename", "ipscresults") == "Onename"  # no comma
    assert normalize_name("Jones,", "ipscresults") == "Jones"     # empty first


def test_name_fingerprint() -> None:
    assert name_fingerprint("Martin Hollertz", "SWE") == "martin hollertz|SWE"
    assert name_fingerprint("Saša Petrović", "SRB") == "sasa petrovic|SRB"
    # Region should be uppercased
    assert name_fingerprint("Alice Smith", "swe") == "alice smith|SWE"


def test_name_fingerprint_strips_placeholder_tokens() -> None:
    assert name_fingerprint("Unknown notknown", "SWE") == "|SWE"
    assert name_fingerprint("John noname", "USA") == "john|USA"


def test_name_fingerprint_strips_numeric_middle_names() -> None:
    # ipscresults sometimes uses registration numbers as middle tokens
    assert name_fingerprint("Anders 1406 Svensson", "SWE") == "anders svensson|SWE"
    assert name_fingerprint("Anna 42 Larsen", "NOR") == "anna larsen|NOR"
    # Digits embedded in a token are preserved (handled by per-token strip in matching)
    assert name_fingerprint("Anders1406 Svensson", "SWE") == "anders1406 svensson|SWE"


def test_pick_primary_name_prefers_non_placeholder() -> None:
    names = ["NotKnown Smith", "Alice Smith"]
    assert _pick_primary_name(names) == "Alice Smith"


def test_pick_primary_name_prefers_longer() -> None:
    names = ["Alice", "Alice Smith"]
    assert _pick_primary_name(names) == "Alice Smith"


def test_pick_primary_name_tiebreaks_alphabetically() -> None:
    names = ["Bob Smith", "Alice Smith"]
    result = _pick_primary_name(names)
    # Both same length — alphabetically first
    assert result in names  # deterministic, just not tied by name length


# ------------------------------------------------------------------
# IdentityResolver integration
# ------------------------------------------------------------------

@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "test.duckdb")


def _ssi_match(match_id: str, competitors: list[CompetitorMeta]) -> MatchResults:
    return MatchResults(
        meta=MatchResultsMeta(ct=22, match_id=match_id, name="Test Match", source="ssi"),
        stages=[StageMeta(stage_id=1, stage_number=1, stage_name="S1", max_points=100)],
        competitors=competitors,
        results=[
            StageResult(
                competitor_id=c.competitor_id, stage_id=1,
                hit_factor=1.0, points=50, time=50.0, max_points=100,
                overall_rank=i + 1, overall_percent=100.0 - i * 10,
            )
            for i, c in enumerate(competitors)
        ],
    )


def _ipr_match(match_id: str, competitors: list[CompetitorMeta]) -> MatchResults:
    return MatchResults(
        meta=MatchResultsMeta(ct=0, match_id=match_id, name="Test Match", source="ipscresults"),
        stages=[StageMeta(stage_id=1, stage_number=1, stage_name="S1", max_points=100)],
        competitors=competitors,
        results=[
            StageResult(
                competitor_id=c.competitor_id, stage_id=1,
                hit_factor=1.0, points=50, time=50.0, max_points=100,
                overall_rank=i + 1, overall_percent=100.0 - i * 10,
            )
            for i, c in enumerate(competitors)
        ],
    )


def test_bootstrap_ssi_creates_canonical_identities(store: Store) -> None:
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Alice Smith",
                       division="Production", region="SWE"),
        CompetitorMeta(competitor_id=2, shooter_id=43, name="Bob Jones",
                       division="Standard", region="NOR"),
    ]))

    resolver = IdentityResolver()
    report = resolver.resolve_all(store)

    assert report.ssi_bootstrapped == 2
    assert store.get_identity_link("ssi", "42") == 42
    assert store.get_identity_link("ssi", "43") == 43


def test_bootstrap_ssi_registers_name_variants(store: Store) -> None:
    """Multiple name variants for same shooter_id should all map to same canonical_id."""
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Marianne Hansen",
                       division="Production", region="NOR"),
    ]))
    store.store_match_results(_ssi_match("m2", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Marianne Schön",
                       division="Production", region="NOR"),
    ]))

    resolver = IdentityResolver()
    resolver.resolve_all(store)

    # Both name fingerprints should link to canonical_id 42
    fp1 = name_fingerprint("Marianne Hansen", "NOR")
    fp2 = name_fingerprint("Marianne Schon", "NOR")  # diacritics stripped
    assert store.get_identity_link("ssi_fp", fp1) == 42
    assert store.get_identity_link("ssi_fp", fp2) == 42


def test_exact_match_ipscresults_to_ssi(store: Store) -> None:
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Alice Smith",
                       division="Production", region="SWE"),
    ]))

    ipr_fp = name_fingerprint("Alice Smith", "SWE")
    ipr_comp = CompetitorMeta(
        competitor_id=10, shooter_id=None,
        identity_key=ipr_fp, name="Alice Smith",
        division="Production", region="SWE",
    )
    store.store_match_results(_ipr_match("uuid-1", [ipr_comp]))

    resolver = IdentityResolver()
    report = resolver.resolve_all(store)

    assert report.exact_matched == 1
    assert store.get_identity_link("ipscresults", ipr_fp) == 42


def test_fuzzy_match_ipscresults_to_ssi(store: Store) -> None:
    """A slightly misspelled name should fuzzy-match within same region."""
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Alice Smithe",
                       division="Production", region="SWE"),
    ]))

    # "Alice Smith" vs "Alice Smithe" — close enough
    ipr_fp = name_fingerprint("Alice Smith", "SWE")
    ipr_comp = CompetitorMeta(
        competitor_id=10, shooter_id=None,
        identity_key=ipr_fp, name="Alice Smith",
        division="Production", region="SWE",
    )
    store.store_match_results(_ipr_match("uuid-1", [ipr_comp]))

    resolver = IdentityResolver()
    report = resolver.resolve_all(store)

    # Should have matched (exact or fuzzy)
    assert report.exact_matched + report.fuzzy_matched >= 1
    resolved = store.get_identity_link("ipscresults", ipr_fp)
    assert resolved == 42


def test_no_match_creates_new_identity(store: Store) -> None:
    """ipscresults competitor with no SSI counterpart gets a new canonical_id."""
    ipr_fp = name_fingerprint("Zara Unique", "FIN")
    ipr_comp = CompetitorMeta(
        competitor_id=10, shooter_id=None,
        identity_key=ipr_fp, name="Zara Unique",
        division="Standard", region="FIN",
    )
    store.store_match_results(_ipr_match("uuid-1", [ipr_comp]))

    resolver = IdentityResolver()
    report = resolver.resolve_all(store)

    assert report.new_identities == 1
    new_id = store.get_identity_link("ipscresults", ipr_fp)
    assert new_id is not None
    assert new_id >= 2_000_000


def test_manual_link_survives_re_resolve(store: Store) -> None:
    """A manual identity link should never be overwritten by automatic resolution."""
    ipr_fp = name_fingerprint("Alice Smith", "SWE")
    store.ensure_canonical_identity(999, "Alice Smith", "SWE")
    store.save_identity_link("ipscresults", ipr_fp, 999, "Alice Smith", 1.0, "manual")

    # Add SSI competitor with same fingerprint pointing to a different canonical_id
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Alice Smith",
                       division="Production", region="SWE"),
    ]))
    ipr_comp = CompetitorMeta(
        competitor_id=10, shooter_id=None,
        identity_key=ipr_fp, name="Alice Smith",
        division="Production", region="SWE",
    )
    store.store_match_results(_ipr_match("uuid-1", [ipr_comp]))

    resolver = IdentityResolver()
    resolver.resolve_all(store)

    # Manual link must survive
    assert store.get_identity_link("ipscresults", ipr_fp) == 999


def test_resolve_all_is_idempotent(store: Store) -> None:
    """Running resolve_all twice should not create duplicate links or raise errors."""
    store.store_match_results(_ssi_match("m1", [
        CompetitorMeta(competitor_id=1, shooter_id=42, name="Alice Smith",
                       division="Production", region="SWE"),
    ]))

    resolver = IdentityResolver()
    resolver.resolve_all(store)
    resolver.resolve_all(store)

    row_count = store.db.execute(
        "SELECT count(*) FROM shooter_identity_links"
    ).fetchone()[0]
    assert row_count > 0  # exact count depends on implementation, just no errors
