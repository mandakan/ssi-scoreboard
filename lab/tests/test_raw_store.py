"""Tests for RawMatchStore — local file cache for raw OData bundles."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.data.raw_store import BUNDLE_SCHEMA_VERSION, RawMatchStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def raw_dir(tmp_path: Path) -> Path:
    return tmp_path / "ipscresults-raw"


@pytest.fixture
def store(raw_dir: Path) -> RawMatchStore:
    return RawMatchStore(raw_dir)


def _sample_bundle(match_id: str = "test-uuid") -> dict:
    return {
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "match_id": match_id,
        "fetched_at": "2025-03-11T12:00:00+00:00",
        "competitors": [{"ID": 1, "Name": "Smith, Alice", "Alias": "alicegun"}],
        "divisions": [{"DivisionCode": 1, "Division": "Production", "Total": 1}],
        "per_division": {
            "1": {
                "stages": [{"ID": 1, "Name": "Stage 1", "MaxPoints": 150}],
                "results": [
                    {
                        "Rank": 1,
                        "CompetitorNumber": 1,
                        "CompetitorName": "Smith, Alice",
                        "StageNumber": 1,
                        "HitFactor": 7.5,
                        "Score": 150,
                        "StageTime": 20.0,
                        "StagePoints": 100.0,
                        "StagePercent": 100.0,
                    }
                ],
            }
        },
    }


# ---------------------------------------------------------------------------
# Local file tests
# ---------------------------------------------------------------------------

def test_has_local_false_initially(store: RawMatchStore) -> None:
    assert not store.has_local("no-such-match")


def test_save_and_load_roundtrip(store: RawMatchStore) -> None:
    bundle = _sample_bundle("match-001")
    store.save("match-001", bundle)

    assert store.has_local("match-001")
    loaded = store.load("match-001")
    assert loaded == bundle


def test_load_returns_none_when_missing(store: RawMatchStore) -> None:
    assert store.load("nonexistent") is None


def test_local_count(store: RawMatchStore) -> None:
    assert store.local_count() == 0
    store.save("m1", _sample_bundle("m1"))
    store.save("m2", _sample_bundle("m2"))
    assert store.local_count() == 2


def test_creates_directory_on_init(tmp_path: Path) -> None:
    nested = tmp_path / "a" / "b" / "c"
    assert not nested.exists()
    RawMatchStore(nested)
    assert nested.is_dir()


def test_file_is_gzip_compressed(store: RawMatchStore, raw_dir: Path) -> None:
    import gzip
    store.save("gz-test", _sample_bundle("gz-test"))
    path = raw_dir / "gz-test.json.gz"
    assert path.exists()
    with gzip.open(path, "rb") as fh:
        content = fh.read()
    assert b"gz-test" in content  # match_id in payload


# ---------------------------------------------------------------------------
# S3 tiered loading tests
# ---------------------------------------------------------------------------

def test_load_hits_s3_when_local_missing(raw_dir: Path) -> None:
    import gzip, json

    bundle = _sample_bundle("s3-match")
    gz_bytes = gzip.compress(json.dumps(bundle).encode())

    mock_s3 = MagicMock()
    mock_body = MagicMock()
    mock_body.read.return_value = gz_bytes
    mock_s3.get_object.return_value = {"Body": mock_body}

    store = RawMatchStore(raw_dir, s3_client=mock_s3, s3_bucket="my-bucket", s3_prefix="lab")
    result = store.load("s3-match")

    assert result == bundle
    mock_s3.get_object.assert_called_once_with(
        Bucket="my-bucket",
        Key="lab/ipscresults/raw/s3-match.json.gz",
    )
    # Should also be cached locally now
    assert store.has_local("s3-match")


def test_load_prefers_local_over_s3(raw_dir: Path) -> None:
    local_bundle = _sample_bundle("cached")
    store_local = RawMatchStore(raw_dir)
    store_local.save("cached", local_bundle)

    mock_s3 = MagicMock()
    store = RawMatchStore(raw_dir, s3_client=mock_s3, s3_bucket="my-bucket")
    result = store.load("cached")

    assert result == local_bundle
    mock_s3.get_object.assert_not_called()


def test_s3_not_found_returns_none(raw_dir: Path) -> None:
    from botocore.exceptions import ClientError  # type: ignore[import-untyped]

    error_response = {"Error": {"Code": "NoSuchKey", "Message": "Not found"}}
    mock_s3 = MagicMock()
    mock_s3.get_object.side_effect = ClientError(error_response, "GetObject")

    store = RawMatchStore(raw_dir, s3_client=mock_s3, s3_bucket="my-bucket")
    assert store.load("missing") is None


def test_save_uploads_to_s3(raw_dir: Path) -> None:
    mock_s3 = MagicMock()
    store = RawMatchStore(raw_dir, s3_client=mock_s3, s3_bucket="my-bucket", s3_prefix="lab")
    bundle = _sample_bundle("upload-test")
    store.save("upload-test", bundle)

    mock_s3.upload_file.assert_called_once()
    args = mock_s3.upload_file.call_args
    assert args[0][1] == "my-bucket"
    assert args[0][2] == "lab/ipscresults/raw/upload-test.json.gz"


def test_no_s3_when_bucket_empty(raw_dir: Path) -> None:
    """S3 client is ignored when bucket is empty string."""
    mock_s3 = MagicMock()
    store = RawMatchStore(raw_dir, s3_client=mock_s3, s3_bucket="")
    store.save("local-only", _sample_bundle("local-only"))
    assert store.load("nonexistent") is None

    mock_s3.get_object.assert_not_called()
    mock_s3.upload_file.assert_not_called()


# ---------------------------------------------------------------------------
# Integration with IpscResultsSyncer
# ---------------------------------------------------------------------------

def test_syncer_uses_raw_store_on_cache_hit(tmp_path: Path) -> None:
    """When a bundle is in the raw store, the syncer should not call fetch_raw_bundle."""
    from src.data.ipscresults import IpscResultsClient, IpscResultsSyncer, IpscMatch
    from src.data.store import Store

    raw_dir = tmp_path / "raw"
    raw_store = RawMatchStore(raw_dir)
    bundle = _sample_bundle("cached-match")
    raw_store.save("cached-match", bundle)

    store = Store(tmp_path / "test.duckdb")
    client = MagicMock(spec=IpscResultsClient)
    syncer = IpscResultsSyncer(client, store, raw_store=raw_store)

    m = IpscMatch(
        id="cached-match",
        name="Test Match",
        region_name="SWE",
        date="2025-01-01",
        level=3,
        discipline="Handgun",
        state=2,
    )

    result, src = syncer._fetch_match(m)

    client.fetch_raw_bundle.assert_not_called()
    assert result is not None
    assert result.meta.match_id == "cached-match"
    assert src == "local"
    store.close()


def test_syncer_saves_bundle_after_api_fetch(tmp_path: Path) -> None:
    """After fetching from the API, the bundle should be persisted in the raw store."""
    from src.data.ipscresults import IpscResultsClient, IpscResultsSyncer, IpscMatch
    from src.data.store import Store

    raw_dir = tmp_path / "raw"
    raw_store = RawMatchStore(raw_dir)

    store = Store(tmp_path / "test.duckdb")
    client = MagicMock(spec=IpscResultsClient)
    client.fetch_raw_bundle.return_value = _sample_bundle("fresh-match")
    syncer = IpscResultsSyncer(client, store, raw_store=raw_store)

    m = IpscMatch(
        id="fresh-match",
        name="Fresh Match",
        region_name="NOR",
        date="2025-02-01",
        level=3,
        discipline="Handgun",
        state=2,
    )

    result, src = syncer._fetch_match(m)

    client.fetch_raw_bundle.assert_called_once_with("fresh-match")
    assert raw_store.has_local("fresh-match")
    assert result is not None
    assert src == "api"
    store.close()
