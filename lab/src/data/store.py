"""DuckDB local store for match data and ratings."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from src.data.models import MatchResults, MatchResultsMeta

# Bump this whenever the schema of any data table changes (not sync_state).
# On version mismatch, all data tables are dropped and recreated; sync from scratch.
SCHEMA_VERSION = "5"

# (name, division, region, category, mu, sigma, matches_played, last_match_date)
RatingRow = tuple[str, str | None, str | None, str | None, float, float, int, str | None]

# Absolute path so the DB always lives at lab/data/lab.duckdb regardless of
# which directory the CLI is invoked from (e.g. project root vs lab/).
DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "data" / "lab.duckdb"

# The sync_state table is never dropped — it persists the watermark and version.
# identity_reviews is also persistent — human decisions survive rating link re-runs.
_BASE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS identity_reviews (
  source     TEXT NOT NULL,
  source_key TEXT NOT NULL,
  decision   TEXT NOT NULL,      -- 'approved' | 'rejected'
  decided_at TIMESTAMP NOT NULL,
  PRIMARY KEY (source, source_key)
);
"""

# All data tables. Dropped and recreated on SCHEMA_VERSION bump.
_DATA_SCHEMA_SQL = """
-- Match metadata (PK includes source)
CREATE TABLE IF NOT EXISTS matches (
  source TEXT NOT NULL,
  ct INTEGER, match_id TEXT, name TEXT, date TIMESTAMP, level TEXT,
  region TEXT, discipline TEXT, competitor_count INTEGER, stage_count INTEGER,
  scoring_completed INTEGER, stored_at TIMESTAMP, synced_at TIMESTAMP,
  skip_reason TEXT,   -- non-NULL when the match was skipped (e.g. HTTP error message)
  PRIMARY KEY (source, ct, match_id)
);

-- Competitors per match.
-- identity_key: str(shooter_id) for SSI, name fingerprint for ipscresults.
CREATE TABLE IF NOT EXISTS competitors (
  source TEXT NOT NULL,
  ct INTEGER, match_id TEXT, competitor_id INTEGER,
  shooter_id INTEGER, identity_key TEXT,
  name TEXT, club TEXT, division TEXT,
  region TEXT, region_display TEXT, category TEXT,
  alias TEXT,
  PRIMARY KEY (source, ct, match_id, competitor_id)
);

-- Stage metadata
CREATE TABLE IF NOT EXISTS stages (
  source TEXT NOT NULL,
  ct INTEGER, match_id TEXT, stage_id INTEGER,
  stage_number INTEGER, stage_name TEXT, max_points INTEGER,
  PRIMARY KEY (source, ct, match_id, stage_id)
);

-- Per-competitor per-stage results (the main analytical table)
CREATE TABLE IF NOT EXISTS stage_results (
  source TEXT NOT NULL,
  ct INTEGER, match_id TEXT, competitor_id INTEGER, stage_id INTEGER,
  hit_factor DOUBLE, points DOUBLE, time DOUBLE, max_points INTEGER,
  a_hits INTEGER, c_hits INTEGER, d_hits INTEGER,
  miss_count INTEGER, no_shoots INTEGER, procedurals INTEGER,
  dq BOOLEAN, dnf BOOLEAN, zeroed BOOLEAN,
  overall_rank INTEGER, overall_percent DOUBLE,
  division_rank INTEGER, division_percent DOUBLE,
  PRIMARY KEY (source, ct, match_id, competitor_id, stage_id)
);

-- Canonical shooter identity table — one row per unique real-world person.
-- SSI shooter_ids are used as canonical_id directly.
-- New (non-SSI) identities get IDs starting from 2_000_000 (see _next_canonical_id).
CREATE TABLE IF NOT EXISTS shooter_identities (
  canonical_id INTEGER PRIMARY KEY,
  primary_name TEXT NOT NULL,
  region TEXT,
  created_at TIMESTAMP
);

-- Maps a source-specific identity to a canonical shooter.
-- source_key: str(shooter_id) for SSI; name fingerprint "normalized|REG" for ipscresults.
-- confidence: 1.0 = exact match; 0.0–1.0 = fuzzy match.
-- method: 'auto_exact', 'auto_fuzzy', 'auto_alias', 'manual'.
-- alias: ipscresults user-chosen handle (e.g. "matusalem"), used as secondary identity signal.
CREATE TABLE IF NOT EXISTS shooter_identity_links (
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  canonical_id INTEGER,
  name_variant TEXT,
  confidence REAL,
  method TEXT,
  linked_at TIMESTAMP,
  alias TEXT,
  PRIMARY KEY (source, source_key)
);

-- Match deduplication links — same real-world match stored under two sources.
-- preferred: 'a' or 'b' — which copy to use during training.
CREATE TABLE IF NOT EXISTS match_links (
  source_a TEXT NOT NULL,
  ct_a INTEGER,
  match_id_a TEXT NOT NULL,
  source_b TEXT NOT NULL,
  ct_b INTEGER,
  match_id_b TEXT NOT NULL,
  confidence REAL,
  method TEXT,
  preferred TEXT,
  linked_at TIMESTAMP,
  PRIMARY KEY (source_a, match_id_a, source_b, match_id_b)
);

-- Rating results per algorithm, per (shooter, division) pair.
-- division = '' (empty string) is the sentinel for cross-division / global ratings.
CREATE TABLE IF NOT EXISTS shooter_ratings (
  algorithm TEXT, shooter_id INTEGER, division TEXT NOT NULL DEFAULT '',
  name TEXT, region TEXT, category TEXT,
  mu DOUBLE, sigma DOUBLE, matches_played INTEGER,
  last_match_date TIMESTAMP, updated_at TIMESTAMP,
  PRIMARY KEY (algorithm, shooter_id, division)
);

-- Rating history (snapshots after each match), keyed per (shooter, division).
CREATE TABLE IF NOT EXISTS rating_history (
  algorithm TEXT, shooter_id INTEGER, division TEXT NOT NULL DEFAULT '',
  match_source TEXT, match_ct INTEGER, match_id TEXT,
  match_date TIMESTAMP, mu DOUBLE, sigma DOUBLE,
  PRIMARY KEY (algorithm, shooter_id, division, match_source, match_ct, match_id)
);
"""


class Store:
    """DuckDB-backed local store for match data and ratings."""

    def __init__(
        self, db_path: Path = DEFAULT_DB_PATH, *, read_only: bool = False
    ) -> None:
        self._read_only = read_only
        if read_only:
            self.db = duckdb.connect(str(db_path), read_only=True)
            return
        db_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.db = duckdb.connect(str(db_path))
            # Verify write access immediately — a second concurrent writer can
            # silently succeed at connect() but fail (or drop) writes at runtime.
            self.db.execute("BEGIN TRANSACTION")
            self.db.execute("ROLLBACK")
        except duckdb.IOException as e:
            raise RuntimeError(
                f"Cannot acquire write lock on {db_path}. "
                "Is another sync or rating process already running? "
                "Stop it first, then retry."
            ) from e
        self.db.execute(_BASE_SCHEMA_SQL)
        self._migrate_if_needed()

    def _migrate_if_needed(self) -> None:
        """Apply schema migrations. Uses targeted per-version upgrades where possible
        to avoid wiping sync data unnecessarily."""
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = 'schema_version'"
        ).fetchone()
        current = row[0] if row else "1"
        if current == SCHEMA_VERSION:
            # Additive column migrations — safe to apply on every startup.
            for col in ["region TEXT", "region_display TEXT", "category TEXT", "alias TEXT"]:
                with contextlib.suppress(Exception):
                    self.db.execute(f"ALTER TABLE competitors ADD COLUMN IF NOT EXISTS {col}")
            for col in ["skip_reason TEXT", "discipline TEXT"]:
                with contextlib.suppress(Exception):
                    self.db.execute(f"ALTER TABLE matches ADD COLUMN IF NOT EXISTS {col}")
            with contextlib.suppress(Exception):
                self.db.execute(
                    "ALTER TABLE shooter_identity_links ADD COLUMN IF NOT EXISTS alias TEXT"
                )
            return

        # v4 → v5: added alias TEXT to competitors and shooter_identity_links.
        if current == "4" and SCHEMA_VERSION == "5":
            with contextlib.suppress(Exception):
                self.db.execute(
                    "ALTER TABLE competitors ADD COLUMN IF NOT EXISTS alias TEXT"
                )
            with contextlib.suppress(Exception):
                self.db.execute(
                    "ALTER TABLE shooter_identity_links ADD COLUMN IF NOT EXISTS alias TEXT"
                )
            self.db.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)",
                [SCHEMA_VERSION],
            )
            return

        # v3 → v5: add discipline to matches (v4), add alias columns (v5).
        if current == "3":
            for stmt in [
                "ALTER TABLE matches ADD COLUMN IF NOT EXISTS discipline TEXT",
                "ALTER TABLE competitors ADD COLUMN IF NOT EXISTS alias TEXT",
                "ALTER TABLE shooter_identity_links ADD COLUMN IF NOT EXISTS alias TEXT",
            ]:
                with contextlib.suppress(Exception):
                    self.db.execute(stmt)
            self.db.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)",
                [SCHEMA_VERSION],
            )
            return

        # v2 → v5: rebuild shooter_ratings/rating_history (division added to PK in v3),
        # add discipline column to matches (v4), add alias columns (v5).
        if current == "2":
            for tbl in ["shooter_ratings", "rating_history"]:
                self.db.execute(f"DROP TABLE IF EXISTS {tbl}")
            self.db.execute("""
                CREATE TABLE IF NOT EXISTS shooter_ratings (
                  algorithm TEXT, shooter_id INTEGER, division TEXT NOT NULL DEFAULT '',
                  name TEXT, region TEXT, category TEXT,
                  mu DOUBLE, sigma DOUBLE, matches_played INTEGER,
                  last_match_date TIMESTAMP, updated_at TIMESTAMP,
                  PRIMARY KEY (algorithm, shooter_id, division)
                )
            """)
            self.db.execute("""
                CREATE TABLE IF NOT EXISTS rating_history (
                  algorithm TEXT, shooter_id INTEGER, division TEXT NOT NULL DEFAULT '',
                  match_source TEXT, match_ct INTEGER, match_id TEXT,
                  match_date TIMESTAMP, mu DOUBLE, sigma DOUBLE,
                  PRIMARY KEY (algorithm, shooter_id, division, match_source, match_ct, match_id)
                )
            """)
            for stmt in [
                "ALTER TABLE matches ADD COLUMN IF NOT EXISTS discipline TEXT",
                "ALTER TABLE competitors ADD COLUMN IF NOT EXISTS alias TEXT",
                "ALTER TABLE shooter_identity_links ADD COLUMN IF NOT EXISTS alias TEXT",
            ]:
                with contextlib.suppress(Exception):
                    self.db.execute(stmt)
            self.db.execute(
                "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)",
                [SCHEMA_VERSION],
            )
            return

        # Unknown version combination — full drop and recreate.
        # This requires a full re-sync from the source APIs.
        for tbl in [
            "stage_results", "stages", "competitors", "matches",
            "shooter_identity_links", "shooter_identities", "match_links",
            "rating_history", "shooter_ratings",
        ]:
            self.db.execute(f"DROP TABLE IF EXISTS {tbl}")

        self.db.execute(_DATA_SCHEMA_SQL)
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('schema_version', ?)",
            [SCHEMA_VERSION],
        )

    def close(self) -> None:
        if not self._read_only:
            self.db.execute("CHECKPOINT")
        self.db.close()

    # ------------------------------------------------------------------
    # Sync watermark — keyed per source so SSI and ipscresults track independently.
    # ------------------------------------------------------------------

    def get_sync_watermark(self, source: str = "ssi") -> str | None:
        """Get the last sync watermark for a source (ISO date string)."""
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = ?",
            [f"last_sync_{source}"],
        ).fetchone()
        return row[0] if row else None

    def set_sync_watermark(self, value: str, source: str = "ssi") -> None:
        """Update the sync watermark for a source."""
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)",
            [f"last_sync_{source}", value],
        )

    # ------------------------------------------------------------------
    # Match storage and retrieval
    # ------------------------------------------------------------------

    def has_match(self, source: str, ct: int, match_id: str) -> bool:
        """Check if a match is already in the store."""
        row = self.db.execute(
            "SELECT 1 FROM matches WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchone()
        return row is not None

    def get_stored_match_ids(self, source: str) -> set[str]:
        """Return the set of all match_ids already stored for a source.

        Use this to bulk-filter a match list instead of calling has_match() in a loop.
        """
        rows = self.db.execute(
            "SELECT match_id FROM matches WHERE source = ?", [source]
        ).fetchall()
        return {str(r[0]) for r in rows}

    def skip_match(
        self, source: str, ct: int, match_id: str, name: str, reason: str = ""
    ) -> None:
        """Record a match as seen but without results.

        Prevents the sync from retrying it on every run. Pass reason= with a
        human-readable explanation (e.g. the HTTP error message) so failures
        are visible and auditable via the matches table.
        """
        synced_at = datetime.now(UTC).isoformat()
        self.db.execute(
            """INSERT OR IGNORE INTO matches
               (source, ct, match_id, name, date, level, region,
                competitor_count, stage_count, scoring_completed, synced_at, skip_reason)
               VALUES (?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 0, ?, ?)""",
            [source, ct, match_id, name, synced_at, reason or None],
        )

    def store_match_results(self, results: MatchResults) -> None:
        """Store a full match result set (metadata + competitors + stages + results).

        All writes are wrapped in a single transaction so a kill mid-write leaves
        the database in a consistent state (either fully stored or not at all).
        """
        meta = results.meta
        source = meta.source
        synced_at = datetime.now(UTC).isoformat()

        self.db.execute("BEGIN")
        try:
            self._store_match_results_inner(meta, source, synced_at, results)
            self.db.execute("COMMIT")
        except Exception:
            self.db.execute("ROLLBACK")
            raise

    def _store_match_results_inner(
        self,
        meta: MatchResultsMeta,
        source: str,
        synced_at: str,
        results: MatchResults,
    ) -> None:
        import pyarrow as pa

        # Upsert match metadata (single row)
        self.db.execute(
            """INSERT OR REPLACE INTO matches
               (source, ct, match_id, name, date, level, region, discipline,
                competitor_count, stage_count, scoring_completed, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                source, meta.ct, meta.match_id, meta.name,
                meta.date, meta.level, meta.region, meta.discipline,
                len(results.competitors), len(results.stages),
                meta.scoring_completed, synced_at,
            ],
        )

        # Delete existing child rows so we can use plain INSERT (no per-row conflict check).
        # This is safe inside the transaction: if the commit fails, the deletes are rolled back.
        for tbl_name in ("competitors", "stages", "stage_results"):
            self.db.execute(
                f"DELETE FROM {tbl_name} WHERE source=? AND ct=? AND match_id=?",  # noqa: S608
                [source, meta.ct, meta.match_id],
            )

        # Bulk insert competitors via PyArrow — DuckDB ingests columnar data orders of
        # magnitude faster than row-by-row executemany.
        if results.competitors:
            identity_keys = [
                str(c.shooter_id) if (source == "ssi" and c.shooter_id is not None)
                else c.identity_key
                for c in results.competitors
            ]
            comp_tbl = pa.table({  # noqa: F841
                "source":        pa.array([source] * len(results.competitors), type=pa.string()),
                "ct":            pa.array([meta.ct] * len(results.competitors), type=pa.int32()),
                "match_id":      pa.array([meta.match_id] * len(results.competitors), type=pa.string()),
                "competitor_id": pa.array([c.competitor_id for c in results.competitors], type=pa.int32()),
                "shooter_id":    pa.array([c.shooter_id for c in results.competitors], type=pa.int32()),
                "identity_key":  pa.array(identity_keys, type=pa.string()),
                "name":          pa.array([c.name for c in results.competitors], type=pa.string()),
                "club":          pa.array([c.club for c in results.competitors], type=pa.string()),
                "division":      pa.array([c.division for c in results.competitors], type=pa.string()),
                "region":        pa.array([c.region for c in results.competitors], type=pa.string()),
                "region_display": pa.array([c.region_display for c in results.competitors], type=pa.string()),
                "category":      pa.array([c.category for c in results.competitors], type=pa.string()),
                "alias":         pa.array([c.alias for c in results.competitors], type=pa.string()),
            })
            self.db.execute("INSERT INTO competitors SELECT * FROM comp_tbl")

        # Bulk insert stages via PyArrow
        if results.stages:
            stg_tbl = pa.table({  # noqa: F841
                "source":       pa.array([source] * len(results.stages), type=pa.string()),
                "ct":           pa.array([meta.ct] * len(results.stages), type=pa.int32()),
                "match_id":     pa.array([meta.match_id] * len(results.stages), type=pa.string()),
                "stage_id":     pa.array([s.stage_id for s in results.stages], type=pa.int32()),
                "stage_number": pa.array([s.stage_number for s in results.stages], type=pa.int32()),
                "stage_name":   pa.array([s.stage_name for s in results.stages], type=pa.string()),
                "max_points":   pa.array([s.max_points for s in results.stages], type=pa.int32()),
            })
            self.db.execute("INSERT INTO stages SELECT * FROM stg_tbl")

        # Bulk insert stage results via PyArrow (the largest table — biggest win here)
        if results.results:
            sr = results.results
            sr_tbl = pa.table({  # noqa: F841
                "source":          pa.array([source] * len(sr), type=pa.string()),
                "ct":              pa.array([meta.ct] * len(sr), type=pa.int32()),
                "match_id":        pa.array([meta.match_id] * len(sr), type=pa.string()),
                "competitor_id":   pa.array([r.competitor_id for r in sr], type=pa.int32()),
                "stage_id":        pa.array([r.stage_id for r in sr], type=pa.int32()),
                "hit_factor":      pa.array([r.hit_factor for r in sr], type=pa.float64()),
                "points":          pa.array([r.points for r in sr], type=pa.float64()),
                "time":            pa.array([r.time for r in sr], type=pa.float64()),
                "max_points":      pa.array([r.max_points for r in sr], type=pa.int32()),
                "a_hits":          pa.array([r.a_hits for r in sr], type=pa.int32()),
                "c_hits":          pa.array([r.c_hits for r in sr], type=pa.int32()),
                "d_hits":          pa.array([r.d_hits for r in sr], type=pa.int32()),
                "miss_count":      pa.array([r.miss_count for r in sr], type=pa.int32()),
                "no_shoots":       pa.array([r.no_shoots for r in sr], type=pa.int32()),
                "procedurals":     pa.array([r.procedurals for r in sr], type=pa.int32()),
                "dq":              pa.array([r.dq for r in sr], type=pa.bool_()),
                "dnf":             pa.array([r.dnf for r in sr], type=pa.bool_()),
                "zeroed":          pa.array([r.zeroed for r in sr], type=pa.bool_()),
                "overall_rank":    pa.array([r.overall_rank for r in sr], type=pa.int32()),
                "overall_percent": pa.array([r.overall_percent for r in sr], type=pa.float64()),
                "division_rank":   pa.array([r.division_rank for r in sr], type=pa.int32()),
                "division_percent": pa.array([r.division_percent for r in sr], type=pa.float64()),
            })
            self.db.execute("INSERT INTO stage_results SELECT * FROM sr_tbl")

    def get_match_count(self) -> int:
        """Return the number of matches in the store."""
        row = self.db.execute("SELECT count(*) FROM matches").fetchone()
        return row[0] if row else 0

    def get_matches_chronological(
        self,
        source: str | None = None,
        disciplines: set[str] | None = None,
    ) -> list[tuple[str, int, str, str | None, str | None]]:
        """Return (source, ct, match_id, date, level) tuples sorted by date ascending.

        Pass source='ssi' or source='ipscresults' to restrict to one source.
        Pass disciplines={'Handgun', 'Rifle'} to filter by discipline value.
        The default (None) for each returns all sources / all disciplines combined.

        Matches with discipline=NULL are excluded when a discipline filter is active.
        """
        conditions: list[str] = ["skip_reason IS NULL"]
        params: list[object] = []

        if source is not None:
            conditions.append("source = ?")
            params.append(source)

        if disciplines:
            placeholders = ", ".join("?" * len(disciplines))
            conditions.append(f"discipline IN ({placeholders})")
            params.extend(sorted(disciplines))

        where = " AND ".join(conditions)
        sql = (
            f"SELECT source, ct, match_id, date, level FROM matches"
            f" WHERE {where} ORDER BY date ASC NULLS LAST"
        )
        rows = self.db.execute(sql, params).fetchall()
        return [
            (str(r[0]), int(r[1]), str(r[2]), str(r[3]) if r[3] else None, r[4])
            for r in rows
        ]

    def get_match_scores(
        self, source: str, ct: int, match_id: str
    ) -> list[tuple[int, float, bool, bool]]:
        """Return (competitor_id, total_points, is_dq, is_zeroed) for match-level scoring."""
        rows = self.db.execute(
            """SELECT competitor_id,
                      SUM(CASE WHEN dq THEN 0.0 ELSE COALESCE(points, 0.0) END) AS total_pts,
                      BOOL_OR(dq)     AS is_dq,
                      BOOL_OR(zeroed) AS is_zeroed
               FROM stage_results
               WHERE source = ? AND ct = ? AND match_id = ?
               GROUP BY competitor_id""",
            [source, ct, match_id],
        ).fetchall()
        return [
            (int(r[0]), 0.0 if r[2] else float(r[1]), bool(r[2]), bool(r[3]))
            for r in rows
        ]

    def get_match_scores_pct(
        self, source: str, ct: int, match_id: str
    ) -> list[tuple[int, float, bool, bool, str | None]]:
        """Return (competitor_id, avg_overall_percent, is_dq, is_zeroed, division).

        Used for match_pct_combined scoring. DNF competitors are excluded.
        DQ competitors get avg_overall_percent=0.0. overall_percent is the
        per-stage % vs the stage winner across all competitors (cross-division).
        """
        from src.data.divisions import normalize_division

        rows = self.db.execute(
            """SELECT sr.competitor_id,
                      AVG(COALESCE(sr.overall_percent, 0.0)) AS avg_pct,
                      BOOL_OR(sr.dq)     AS is_dq,
                      BOOL_OR(sr.zeroed) AS is_zeroed,
                      c.division
               FROM stage_results sr
               JOIN competitors c
                 ON c.source = sr.source AND c.ct = sr.ct
                AND c.match_id = sr.match_id
                AND c.competitor_id = sr.competitor_id
               WHERE sr.source = ? AND sr.ct = ? AND sr.match_id = ?
                 AND sr.dnf = false
               GROUP BY sr.competitor_id, c.division""",
            [source, ct, match_id],
        ).fetchall()
        return [
            (
                int(r[0]),
                0.0 if r[2] else float(r[1]),
                bool(r[2]),
                bool(r[3]),
                normalize_division(r[4]),
            )
            for r in rows
        ]

    def get_overall_pct_by_division(
        self, match_keys: list[tuple[str, int, str]]
    ) -> dict[str | None, list[float]]:
        """Return per-division lists of avg_overall_percent across a set of matches.

        Used to compute division weight factors for match_pct_combined scoring.
        DNF competitors are excluded. DQ/zeroed competitors contribute 0.0.
        """
        from collections import defaultdict

        from src.data.divisions import normalize_division

        result: dict[str | None, list[float]] = defaultdict(list)
        for source, ct, match_id in match_keys:
            rows = self.db.execute(
                """SELECT c.division,
                          AVG(CASE WHEN sr.dq OR sr.zeroed THEN 0.0
                                   ELSE COALESCE(sr.overall_percent, 0.0) END) AS avg_pct
                   FROM stage_results sr
                   JOIN competitors c
                     ON c.source = sr.source AND c.ct = sr.ct
                    AND c.match_id = sr.match_id
                    AND c.competitor_id = sr.competitor_id
                   WHERE sr.source = ? AND sr.ct = ? AND sr.match_id = ?
                     AND sr.dnf = false
                   GROUP BY sr.competitor_id, c.division""",
                [source, ct, match_id],
            ).fetchall()
            for div_raw, avg_pct in rows:
                if avg_pct is not None:
                    result[normalize_division(div_raw)].append(float(avg_pct))
        return dict(result)

    def get_stage_results_for_match(
        self, source: str, ct: int, match_id: str
    ) -> list[tuple[int, int, float | None, bool, bool, bool]]:
        """Return (competitor_id, stage_id, hit_factor, dq, dnf, zeroed) for a match."""
        rows = self.db.execute(
            """SELECT competitor_id, stage_id, hit_factor, dq, dnf, zeroed
               FROM stage_results WHERE source = ? AND ct = ? AND match_id = ?""",
            [source, ct, match_id],
        ).fetchall()
        return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows]

    # ------------------------------------------------------------------
    # Competitor dimension maps — source-aware, same return type as before.
    # ------------------------------------------------------------------

    def get_competitor_shooter_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, int | None]:
        """Return competitor_id → raw shooter_id mapping for a match.

        For SSI this is the SSI shooter_id. For ipscresults all values are None.
        Use get_canonical_competitor_map() for identity-resolved IDs.
        """
        rows = self.db.execute(
            "SELECT competitor_id, shooter_id FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def get_canonical_competitor_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, int | None]:
        """Return competitor_id → canonical_id via identity links.

        For SSI competitors with no identity link yet, falls back to shooter_id.
        For ipscresults competitors with no link, returns None.
        """
        rows = self.db.execute(
            """SELECT c.competitor_id,
                      COALESCE(CAST(l.canonical_id AS INTEGER), c.shooter_id) AS resolved_id
               FROM competitors c
               LEFT JOIN shooter_identity_links l
                 ON l.source = c.source AND l.source_key = c.identity_key
               WHERE c.source = ? AND c.ct = ? AND c.match_id = ?""",
            [source, ct, match_id],
        ).fetchall()
        return {int(r[0]): int(r[1]) if r[1] is not None else None for r in rows}

    def get_competitor_division_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, str | None]:
        """Return competitor_id → normalized division mapping for a match."""
        from src.data.divisions import normalize_division

        rows = self.db.execute(
            "SELECT competitor_id, division FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: normalize_division(r[1]) for r in rows}

    def get_competitor_name_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, str]:
        """Return competitor_id → name mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, name FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def get_competitor_region_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, str | None]:
        """Return competitor_id → region mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, region FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def get_competitor_category_map(
        self, source: str, ct: int, match_id: str
    ) -> dict[int, str | None]:
        """Return competitor_id → category mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, category FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    # ------------------------------------------------------------------
    # Identity resolution tables
    # ------------------------------------------------------------------

    def _next_canonical_id(self) -> int:
        """Get next available canonical_id for a new (non-SSI) identity.

        SSI shooter_ids serve as canonical_ids directly (they're < 200_000 in practice).
        New ipscresults-only identities start from 2_000_000 to avoid collisions.
        """
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = 'identity_seq'"
        ).fetchone()
        seq = int(row[0]) if row else 2_000_000
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('identity_seq', ?)",
            [str(seq + 1)],
        )
        return seq

    def _allocate_canonical_ids(self, count: int) -> range:
        """Atomically allocate `count` new canonical IDs and return them as a range.

        Reads the sequence counter once, bumps it by count, and writes it back.
        Far faster than calling _next_canonical_id() in a loop for bulk operations.
        """
        if count == 0:
            return range(0, 0)
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = 'identity_seq'"
        ).fetchone()
        start = int(row[0]) if row else 2_000_000
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('identity_seq', ?)",
            [str(start + count)],
        )
        return range(start, start + count)

    def ensure_canonical_identity(
        self, canonical_id: int, primary_name: str, region: str | None
    ) -> None:
        """Insert or update a canonical identity row."""
        self.db.execute(
            """INSERT OR REPLACE INTO shooter_identities
               (canonical_id, primary_name, region, created_at)
               VALUES (?, ?, ?, ?)""",
            [canonical_id, primary_name, region, datetime.now(UTC).isoformat()],
        )

    def save_identity_link(
        self,
        source: str,
        source_key: str,
        canonical_id: int,
        name_variant: str,
        confidence: float,
        method: str,
    ) -> None:
        """Upsert an identity link. Manual links (method='manual') are never overwritten."""
        existing = self.db.execute(
            "SELECT method FROM shooter_identity_links WHERE source = ? AND source_key = ?",
            [source, source_key],
        ).fetchone()
        if existing and existing[0] == "manual":
            return  # Never overwrite manual links automatically
        self.db.execute(
            """INSERT OR REPLACE INTO shooter_identity_links
               (source, source_key, canonical_id, name_variant, confidence, method, linked_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [source, source_key, canonical_id, name_variant, confidence, method,
             datetime.now(UTC).isoformat()],
        )

    def get_identity_link(self, source: str, source_key: str) -> int | None:
        """Return canonical_id for a source-specific key, or None if not linked."""
        row = self.db.execute(
            "SELECT canonical_id FROM shooter_identity_links"
            " WHERE source = ? AND source_key = ?",
            [source, source_key],
        ).fetchone()
        return int(row[0]) if row else None

    def bulk_save_identities(
        self,
        rows: list[tuple[int, str, str | None]],
    ) -> None:
        """Bulk upsert canonical identity rows via PyArrow.

        rows: list of (canonical_id, primary_name, region).
        """
        if not rows:
            return
        import pyarrow as pa  # type: ignore[import-untyped]

        now = datetime.now(UTC).isoformat()
        tbl = pa.table({  # noqa: F841
            "canonical_id": pa.array([r[0] for r in rows], type=pa.int64()),
            "primary_name": pa.array([r[1] for r in rows], type=pa.string()),
            "region": pa.array([r[2] for r in rows], type=pa.string()),
            "created_at": pa.array([now] * len(rows), type=pa.string()),
        })
        self.db.execute(
            "INSERT OR REPLACE INTO shooter_identities SELECT * FROM tbl"
        )

    def bulk_save_identity_links(
        self,
        rows: list[tuple[str, str, int, str, float, str, str | None]],
    ) -> None:
        """Bulk upsert identity links via PyArrow, respecting manual overrides.

        rows: list of (source, source_key, canonical_id, name_variant, confidence, method, alias).
        Manual links already in the DB are preserved.
        """
        if not rows:
            return
        import pyarrow as pa

        # Load existing manual links to exclude them from the bulk upsert.
        manual_keys: set[tuple[str, str]] = set()
        manual_rows = self.db.execute(
            "SELECT source, source_key FROM shooter_identity_links WHERE method = 'manual'"
        ).fetchall()
        for r in manual_rows:
            manual_keys.add((str(r[0]), str(r[1])))

        filtered = [r for r in rows if (r[0], r[1]) not in manual_keys]
        if not filtered:
            return

        now = datetime.now(UTC).isoformat()
        tbl = pa.table({  # noqa: F841
            "source": pa.array([r[0] for r in filtered], type=pa.string()),
            "source_key": pa.array([r[1] for r in filtered], type=pa.string()),
            "canonical_id": pa.array([r[2] for r in filtered], type=pa.int64()),
            "name_variant": pa.array([r[3] for r in filtered], type=pa.string()),
            "confidence": pa.array([r[4] for r in filtered], type=pa.float64()),
            "method": pa.array([r[5] for r in filtered], type=pa.string()),
            "linked_at": pa.array([now] * len(filtered), type=pa.string()),
            "alias": pa.array([r[6] for r in filtered], type=pa.string()),
        })
        self.db.execute(
            "INSERT OR REPLACE INTO shooter_identity_links SELECT * FROM tbl"
        )

    def get_all_ssi_competitors(
        self,
    ) -> list[tuple[int, str, str | None]]:
        """Return (shooter_id, name, region) for all distinct SSI competitors with a shooter_id.

        Includes all name variants — callers group by shooter_id to pick the primary name.
        """
        rows = self.db.execute(
            """SELECT DISTINCT shooter_id, name, region
               FROM competitors
               WHERE source = 'ssi' AND shooter_id IS NOT NULL
               ORDER BY shooter_id"""
        ).fetchall()
        return [(int(r[0]), str(r[1]), r[2]) for r in rows]

    def get_unlinked_ipscresults_competitors(
        self,
    ) -> list[tuple[str, str | None, str | None]]:
        """Return (name, region, alias) triples for unlinked ipscresults competitors.

        When multiple aliases exist for the same (name, region), the lexicographically
        largest non-null alias is returned (MAX picks any non-null value over null).
        """
        rows = self.db.execute(
            """SELECT c.name, c.region, MAX(c.alias) AS alias
               FROM competitors c
               LEFT JOIN shooter_identity_links l
                 ON l.source = 'ipscresults' AND l.source_key = c.identity_key
               WHERE c.source = 'ipscresults' AND l.source_key IS NULL
               GROUP BY c.name, c.region
               ORDER BY c.name"""
        ).fetchall()
        return [(str(r[0]), r[1], r[2]) for r in rows]

    def get_identity_stats(self) -> dict[str, int]:
        """Return counts for identity resolution summary reporting."""
        stats: dict[str, int] = {}
        for label, method in [
            ("exact", "auto_exact"), ("fuzzy", "auto_fuzzy"), ("manual", "manual")
        ]:
            row = self.db.execute(
                "SELECT count(*) FROM shooter_identity_links WHERE method = ?",
                [method],
            ).fetchone()
            stats[label] = row[0] if row else 0
        row = self.db.execute(
            "SELECT count(*) FROM competitors"
            " WHERE source = 'ipscresults' AND identity_key NOT IN"
            "   (SELECT source_key FROM shooter_identity_links WHERE source = 'ipscresults')"
        ).fetchone()
        stats["unlinked"] = row[0] if row else 0
        return stats

    def mark_identity_reviewed(
        self, source: str, source_key: str, decision: str
    ) -> None:
        """Record a human review decision ('approved' or 'rejected') for an auto-fuzzy link.

        Persisted in identity_reviews, which survives `rating link` re-runs.
        """
        self.db.execute(
            """INSERT OR REPLACE INTO identity_reviews
               (source, source_key, decision, decided_at)
               VALUES (?, ?, ?, ?)""",
            [source, source_key, decision, datetime.now(UTC).isoformat()],
        )

    def reject_identity_link(self, source: str, source_key: str) -> int:
        """Reject an auto-fuzzy identity link by splitting it into a new manual identity.

        Allocates a fresh canonical_id, creates the shooter_identities row, and inserts a
        method='manual' link — which replaces the auto_fuzzy entry (same PK) and will never
        be overwritten by future `rating link` runs.

        Returns the newly allocated canonical_id.
        """
        row = self.db.execute(
            """SELECT sil.name_variant, si.region
               FROM shooter_identity_links sil
               JOIN shooter_identities si ON si.canonical_id = sil.canonical_id
               WHERE sil.source = ? AND sil.source_key = ?""",
            [source, source_key],
        ).fetchone()
        if row is None:
            raise ValueError(f"No identity link found for {source!r} / {source_key!r}")
        name_variant, region = str(row[0]), row[1]

        (new_id,) = self._allocate_canonical_ids(1)
        self.ensure_canonical_identity(new_id, name_variant, region)
        self.db.execute(
            """INSERT OR REPLACE INTO shooter_identity_links
               (source, source_key, canonical_id, name_variant,
                confidence, method, linked_at, alias)
               VALUES (?, ?, ?, ?, 1.0, 'manual', ?, NULL)""",
            [source, source_key, new_id, name_variant, datetime.now(UTC).isoformat()],
        )
        return new_id

    # ------------------------------------------------------------------
    # Match deduplication tables
    # ------------------------------------------------------------------

    def save_match_link(
        self,
        source_a: str, ct_a: int, match_id_a: str,
        source_b: str, ct_b: int, match_id_b: str,
        confidence: float,
        method: str,
        preferred: str,
    ) -> None:
        """Record a deduplication link between two matches from different sources."""
        self.db.execute(
            """INSERT OR REPLACE INTO match_links
               (source_a, ct_a, match_id_a, source_b, ct_b, match_id_b,
                confidence, method, preferred, linked_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [source_a, ct_a, match_id_a, source_b, ct_b, match_id_b,
             confidence, method, preferred, datetime.now(UTC).isoformat()],
        )

    def get_dedup_skip_set(self) -> set[tuple[str, int, str]]:
        """Return the set of (source, ct, match_id) tuples to skip during training.

        For each match_link, the non-preferred side is excluded.
        If preferred='a', skip (source_b, ct_b, match_id_b) and vice versa.
        """
        rows = self.db.execute(
            "SELECT source_a, ct_a, match_id_a, source_b, ct_b, match_id_b, preferred"
            " FROM match_links"
        ).fetchall()
        skip: set[tuple[str, int, str]] = set()
        for r in rows:
            if r[6] == "a":
                skip.add((str(r[3]), int(r[4]), str(r[5])))
            else:
                skip.add((str(r[0]), int(r[1]), str(r[2])))
        return skip

    def get_match_links_count(self) -> int:
        """Return total number of match deduplication links."""
        row = self.db.execute("SELECT count(*) FROM match_links").fetchone()
        return row[0] if row else 0

    def clear_auto_links(self) -> None:
        """Delete all automatically-generated identity and dedup links, preserving manual ones.

        Removes:
        - All shooter_identity_links with method != 'manual'
        - All shooter_identities with canonical_id >= 2_000_000 (ipscresults-only) that are
          no longer referenced by any remaining identity link
        - All match_links (no manual concept for match dedup)
        - Resets the identity_seq counter so new IDs are assigned cleanly from the gap

        Manual identity links (method='manual') are always preserved.
        Safe to call before re-running resolve_all().
        """
        self.db.execute("DELETE FROM shooter_identity_links WHERE method != 'manual'")

        # Remove orphaned ipscresults-only canonical identities (>= 2_000_000) that are
        # no longer referenced by any remaining (manual) link.
        self.db.execute(
            """DELETE FROM shooter_identities
               WHERE canonical_id >= 2000000
                 AND canonical_id NOT IN (
                     SELECT canonical_id FROM shooter_identity_links
                 )"""
        )

        # Reset identity_seq to just above any surviving manual ipscresults canonical IDs.
        row = self.db.execute(
            "SELECT MAX(canonical_id) FROM shooter_identity_links WHERE canonical_id >= 2000000"
        ).fetchone()
        next_seq = (int(row[0]) + 1) if row and row[0] is not None else 2_000_000
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('identity_seq', ?)",
            [str(next_seq)],
        )

        self.db.execute("DELETE FROM match_links")

    # ------------------------------------------------------------------
    # Rating storage
    # ------------------------------------------------------------------

    def list_algorithms(self) -> list[str]:
        """Return all algorithm names currently stored in shooter_ratings."""
        rows = self.db.execute(
            "SELECT DISTINCT algorithm FROM shooter_ratings ORDER BY algorithm"
        ).fetchall()
        return [str(r[0]) for r in rows]

    def drop_ratings(self, algorithm: str) -> int:
        """Delete all shooter_ratings and rating_history rows for ``algorithm``.

        Returns the number of shooter_ratings rows deleted.
        """
        row = self.db.execute(
            "SELECT COUNT(*) FROM shooter_ratings WHERE algorithm = ?", [algorithm]
        ).fetchone()
        count = int(row[0]) if row else 0
        self.db.execute("DELETE FROM shooter_ratings WHERE algorithm = ?", [algorithm])
        self.db.execute("DELETE FROM rating_history WHERE algorithm = ?", [algorithm])
        return count

    def save_ratings(
        self, algorithm: str, ratings: dict[tuple[int, str | None], RatingRow]
    ) -> None:
        """Save ratings for an algorithm.

        Keys: (shooter_id, division) — division=None is stored as '' (empty string sentinel).
        Values: (name, division, region, category, mu, sigma, matches_played, last_match_date).

        Uses DELETE + bulk INSERT via a temporary table for DuckDB-optimal speed.
        """
        import pyarrow as pa

        updated_at = datetime.now(UTC).isoformat()
        self.db.execute(
            "DELETE FROM shooter_ratings WHERE algorithm = ?", [algorithm]
        )

        # Build a PyArrow table — DuckDB ingests this columnar data orders of
        # magnitude faster than row-by-row executemany.
        algorithms, sids, divs = [], [], []
        names, regions, categories = [], [], []
        mus, sigmas, playeds, last_dates, updated_ats = [], [], [], [], []

        for (sid, div), (name, _div, region, category, mu, sigma, played, last_date) in (
            ratings.items()
        ):
            algorithms.append(algorithm)
            sids.append(sid)
            divs.append(div or "")
            names.append(name)
            regions.append(region)
            categories.append(category)
            mus.append(mu)
            sigmas.append(sigma)
            playeds.append(played)
            last_dates.append(last_date)
            updated_ats.append(updated_at)

        tbl = pa.table({  # noqa: F841 — DuckDB references local vars by name in SQL
            "algorithm": pa.array(algorithms, type=pa.string()),
            "shooter_id": pa.array(sids, type=pa.int64()),
            "division": pa.array(divs, type=pa.string()),
            "name": pa.array(names, type=pa.string()),
            "region": pa.array(regions, type=pa.string()),
            "category": pa.array(categories, type=pa.string()),
            "mu": pa.array(mus, type=pa.float64()),
            "sigma": pa.array(sigmas, type=pa.float64()),
            "matches_played": pa.array(playeds, type=pa.int64()),
            "last_match_date": pa.array(last_dates, type=pa.string()),
            "updated_at": pa.array(updated_ats, type=pa.string()),
        })
        self.db.execute(
            "INSERT INTO shooter_ratings SELECT * FROM tbl"
        )

    def save_rating_snapshot(
        self,
        algorithm: str,
        shooter_id: int,
        match_source: str,
        match_ct: int,
        match_id: str,
        match_date: str | None,
        mu: float,
        sigma: float,
        division: str | None = None,
    ) -> None:
        """Save a rating history snapshot after processing a match."""
        db_div = division or ""
        self.db.execute(
            """INSERT OR REPLACE INTO rating_history
               (algorithm, shooter_id, division, match_source, match_ct, match_id,
                match_date, mu, sigma)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [algorithm, shooter_id, db_div, match_source, match_ct, match_id,
             match_date, mu, sigma],
        )
