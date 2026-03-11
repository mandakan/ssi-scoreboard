"""Raw OData bundle cache — local file + optional S3/R2 storage.

Each ipscresults match is stored as a single gzip-compressed JSON file
containing the complete raw OData API responses for that match.  Storing
the raw responses (not parsed Pydantic objects) means future schema changes
can be applied by re-parsing the local files without hitting the remote API.

File layout::

    Local:  {raw_dir}/{match_id}.json.gz
    S3/R2:  {s3_prefix}/ipscresults/raw/{match_id}.json.gz

Bundle schema (version 1)::

    {
        "schema_version": 1,
        "match_id": "...",
        "fetched_at": "ISO-8601",
        "competitors": [...],        // Stats.CompetitorList value array
        "divisions":   [...],        // Stats.DivisionList value array
        "per_division": {
            "<div_code>": {          // keyed by string(DivisionCode)
                "stages":  [...],    // Stats.StageList value array
                "results": [...]     // Stats.StageResult value array
            }
        }
    }

S3 integration uses the same env vars as ``db-push`` / ``db-pull``:

    LAB_S3_BUCKET   — bucket name (required for S3 use)
    LAB_S3_PREFIX   — key prefix, default "lab"
    LAB_S3_ENDPOINT — endpoint URL (Cloudflare R2 only)

Pass an already-configured boto3 client (via ``_s3_client()`` in cli.py)
so that auth and endpoint configuration are shared with the rest of the CLI.
"""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

# Bump when the bundle JSON structure changes incompatibly.
# Old bundles with a different version are still readable — callers decide
# whether to accept them or force a re-fetch.
BUNDLE_SCHEMA_VERSION = 1

# S3 key template: {prefix}/ipscresults/raw/{match_id}.json.gz
_S3_KEY_TMPL = "{prefix}/ipscresults/raw/{match_id}.json.gz"


class RawMatchStore:
    """Tiered local-file + S3 cache for raw ipscresults OData bundles.

    Load order: local file → S3 (downloads and caches locally) → None.
    Save order: local file always; S3 upload when a client is configured.

    S3 is optional — omit ``s3_client`` to use local storage only.
    """

    def __init__(
        self,
        local_dir: Path,
        *,
        s3_client: Any = None,
        s3_bucket: str = "",
        s3_prefix: str = "lab",
    ) -> None:
        self.local_dir = local_dir
        self._s3 = s3_client
        self._bucket = s3_bucket
        self._prefix = s3_prefix.rstrip("/")
        local_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def has_local(self, match_id: str) -> bool:
        """Return True if a local bundle file exists for this match."""
        return self._local_path(match_id).exists()

    def load(self, match_id: str) -> dict[str, Any] | None:
        """Return the bundle for ``match_id``, or None if not cached.

        Tier 1 — local file: read and return immediately.
        Tier 2 — S3: download to the local directory, then return.
        Tier 3 — absent: return None (caller should fetch from API).
        """
        local = self._local_path(match_id)
        if local.exists():
            return _read_gz(local)

        if self._s3 and self._bucket:
            key = self._s3_key(match_id)
            try:
                obj = self._s3.get_object(Bucket=self._bucket, Key=key)
                raw_bytes = obj["Body"].read()  # already gzip-compressed
                tmp = local.with_name(local.name + ".tmp")
                try:
                    tmp.write_bytes(raw_bytes)
                    tmp.replace(local)  # atomic on POSIX
                except Exception:
                    tmp.unlink(missing_ok=True)
                    raise
                log.debug("s3 hit: downloaded %s → %s", key, local.name)
                return _read_gz(local)
            except Exception as exc:  # noqa: BLE001
                if _is_not_found(exc):
                    return None
                raise

        return None

    def save(self, match_id: str, bundle: dict[str, Any]) -> None:
        """Persist ``bundle`` locally and upload to S3 if configured."""
        local = self._local_path(match_id)
        _write_gz(local, bundle)
        log.debug("saved raw bundle: %s", local.name)

        if self._s3 and self._bucket:
            key = self._s3_key(match_id)
            try:
                self._s3.upload_file(str(local), self._bucket, key)
                log.debug("s3 upload: %s → s3://%s/%s", local.name, self._bucket, key)
            except Exception as exc:  # noqa: BLE001
                log.warning("S3 upload failed for %s: %s", match_id, exc)

    def local_count(self) -> int:
        """Return the number of bundle files stored locally."""
        return sum(1 for _ in self.local_dir.glob("*.json.gz"))

    @property
    def s3_configured(self) -> bool:
        """True when an S3 client and bucket are both set."""
        return bool(self._s3 and self._bucket)

    @property
    def s3_location(self) -> str:
        """Human-readable S3 path prefix, e.g. 's3://bucket/lab/ipscresults/raw/'."""
        return f"s3://{self._bucket}/{self._prefix}/ipscresults/raw/"

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _local_path(self, match_id: str) -> Path:
        return self.local_dir / f"{match_id}.json.gz"

    def _s3_key(self, match_id: str) -> str:
        return _S3_KEY_TMPL.format(prefix=self._prefix, match_id=match_id)


# ---------------------------------------------------------------------------
# Module-level gz helpers (no class state needed)
# ---------------------------------------------------------------------------

def _read_gz(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rb") as fh:
        return json.loads(fh.read())  # type: ignore[no-any-return]


def _write_gz(path: Path, data: dict[str, Any]) -> None:
    """Write ``data`` as gzip-compressed JSON to ``path`` atomically.

    Uses a sibling temp file + os.replace() so a kill mid-write never leaves
    a truncated/corrupt file at the destination.
    """
    import os
    import tempfile

    payload = json.dumps(data, ensure_ascii=False).encode()
    fd, tmp_str = tempfile.mkstemp(dir=path.parent, suffix=".json.gz.tmp")
    tmp = Path(tmp_str)
    try:
        with os.fdopen(fd, "wb") as raw_fh, gzip.open(raw_fh, "wb", compresslevel=6) as gz_fh:
            gz_fh.write(payload)
        tmp.replace(path)  # atomic on POSIX; near-atomic on Windows
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _is_not_found(exc: Exception) -> bool:
    """Return True if ``exc`` is a boto3 NoSuchKey / 404 error."""
    try:
        from botocore.exceptions import ClientError
        if isinstance(exc, ClientError):
            code = exc.response.get("Error", {}).get("Code", "")
            return code in ("NoSuchKey", "404")
    except ImportError:
        pass
    return False
