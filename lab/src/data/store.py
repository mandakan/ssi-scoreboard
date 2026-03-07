"""DuckDB local store for match data and ratings."""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from pathlib import Path

import duckdb

from src.data.models import MatchResults

# Bump this whenever the schema of any data table changes (not sync_state).
# On version mismatch, all data tables are dropped and recreated; sync from scratch.
SCHEMA_VERSION = "2"

# (name, division, region, category, mu, sigma, matches_played, last_match_date)
RatingRow = tuple[str, str | None, str | None, str | None, float, float, int, str | None]

DEFAULT_DB_PATH = Path("data/lab.duckdb")

# The sync_state table is never dropped — it persists the watermark and version.
_BASE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
"""

# All data tables. Dropped and recreated on SCHEMA_VERSION bump.
_DATA_SCHEMA_SQL = """
-- Match metadata (PK includes source)
CREATE TABLE IF NOT EXISTS matches (
  source TEXT NOT NULL,
  ct INTEGER, match_id TEXT, name TEXT, date TIMESTAMP, level TEXT,
  region TEXT, competitor_count INTEGER, stage_count INTEGER,
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
-- method: 'auto_exact', 'auto_fuzzy', 'manual'.
CREATE TABLE IF NOT EXISTS shooter_identity_links (
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  canonical_id INTEGER,
  name_variant TEXT,
  confidence REAL,
  method TEXT,
  linked_at TIMESTAMP,
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

-- Rating results per algorithm
CREATE TABLE IF NOT EXISTS shooter_ratings (
  algorithm TEXT, shooter_id INTEGER, name TEXT, division TEXT,
  region TEXT, category TEXT,
  mu DOUBLE, sigma DOUBLE, matches_played INTEGER,
  last_match_date TIMESTAMP, updated_at TIMESTAMP,
  PRIMARY KEY (algorithm, shooter_id)
);

-- Rating history (snapshots after each match)
CREATE TABLE IF NOT EXISTS rating_history (
  algorithm TEXT, shooter_id INTEGER,
  match_source TEXT, match_ct INTEGER, match_id TEXT,
  match_date TIMESTAMP, mu DOUBLE, sigma DOUBLE,
  PRIMARY KEY (algorithm, shooter_id, match_source, match_ct, match_id)
);
"""


class Store:
    """DuckDB-backed local store for match data and ratings."""

    def __init__(self, db_path: Path = DEFAULT_DB_PATH) -> None:
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
        """Drop and recreate data tables if SCHEMA_VERSION has changed."""
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = 'schema_version'"
        ).fetchone()
        current = row[0] if row else "1"
        if current == SCHEMA_VERSION:
            # Additive column migrations — safe to apply on every startup.
            for col in ["region TEXT", "region_display TEXT", "category TEXT"]:
                with contextlib.suppress(Exception):
                    self.db.execute(f"ALTER TABLE competitors ADD COLUMN IF NOT EXISTS {col}")
            for col in ["region TEXT", "category TEXT"]:
                with contextlib.suppress(Exception):
                    self.db.execute(f"ALTER TABLE shooter_ratings ADD COLUMN IF NOT EXISTS {col}")
            with contextlib.suppress(Exception):
                self.db.execute(
                    "ALTER TABLE matches ADD COLUMN IF NOT EXISTS skip_reason TEXT"
                )
            return

        # Version mismatch — drop all data tables and recreate.
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
        """Store a full match result set (metadata + competitors + stages + results)."""
        meta = results.meta
        source = meta.source
        synced_at = datetime.now(UTC).isoformat()

        # Upsert match metadata
        self.db.execute(
            """INSERT OR REPLACE INTO matches
               (source, ct, match_id, name, date, level, region,
                competitor_count, stage_count, scoring_completed, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                source, meta.ct, meta.match_id, meta.name,
                meta.date, meta.level, meta.region,
                len(results.competitors), len(results.stages),
                meta.scoring_completed, synced_at,
            ],
        )

        # Upsert competitors
        for c in results.competitors:
            # For SSI: use str(shooter_id) as identity_key if available.
            if source == "ssi":
                identity_key = str(c.shooter_id) if c.shooter_id is not None else c.identity_key
            else:
                identity_key = c.identity_key

            self.db.execute(
                """INSERT OR REPLACE INTO competitors
                   (source, ct, match_id, competitor_id, shooter_id, identity_key,
                    name, club, division, region, region_display, category)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    source, meta.ct, meta.match_id,
                    c.competitor_id, c.shooter_id, identity_key,
                    c.name, c.club, c.division,
                    c.region, c.region_display, c.category,
                ],
            )

        # Upsert stages
        for s in results.stages:
            self.db.execute(
                """INSERT OR REPLACE INTO stages
                   (source, ct, match_id, stage_id, stage_number, stage_name, max_points)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [source, meta.ct, meta.match_id,
                 s.stage_id, s.stage_number, s.stage_name, s.max_points],
            )

        # Upsert stage results
        for r in results.results:
            self.db.execute(
                """INSERT OR REPLACE INTO stage_results
                   (source, ct, match_id, competitor_id, stage_id,
                    hit_factor, points, time, max_points,
                    a_hits, c_hits, d_hits,
                    miss_count, no_shoots, procedurals,
                    dq, dnf, zeroed,
                    overall_rank, overall_percent,
                    division_rank, division_percent)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    source, meta.ct, meta.match_id, r.competitor_id, r.stage_id,
                    r.hit_factor, r.points, r.time, r.max_points,
                    r.a_hits, r.c_hits, r.d_hits,
                    r.miss_count, r.no_shoots, r.procedurals,
                    r.dq, r.dnf, r.zeroed,
                    r.overall_rank, r.overall_percent,
                    r.division_rank, r.division_percent,
                ],
            )

    def get_match_count(self) -> int:
        """Return the number of matches in the store."""
        row = self.db.execute("SELECT count(*) FROM matches").fetchone()
        return row[0] if row else 0

    def get_matches_chronological(
        self, source: str | None = None
    ) -> list[tuple[str, int, str, str | None, str | None]]:
        """Return (source, ct, match_id, date, level) tuples sorted by date ascending.

        Pass source='ssi' or source='ipscresults' to restrict to one source.
        The default (None) returns all sources combined.
        """
        if source is not None:
            rows = self.db.execute(
                "SELECT source, ct, match_id, date, level FROM matches"
                " WHERE source = ? ORDER BY date ASC NULLS LAST",
                [source],
            ).fetchall()
        else:
            rows = self.db.execute(
                "SELECT source, ct, match_id, date, level FROM matches"
                " ORDER BY date ASC NULLS LAST"
            ).fetchall()
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
        """Return competitor_id → division mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, division FROM competitors"
            " WHERE source = ? AND ct = ? AND match_id = ?",
            [source, ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

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
    ) -> list[tuple[str, str | None]]:
        """Return (name, region) pairs from ipscresults competitors not yet in identity_links."""
        rows = self.db.execute(
            """SELECT DISTINCT c.name, c.region
               FROM competitors c
               LEFT JOIN shooter_identity_links l
                 ON l.source = 'ipscresults' AND l.source_key = c.identity_key
               WHERE c.source = 'ipscresults' AND l.source_key IS NULL
               ORDER BY c.name"""
        ).fetchall()
        return [(str(r[0]), r[1]) for r in rows]

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

    # ------------------------------------------------------------------
    # Rating storage
    # ------------------------------------------------------------------

    def save_ratings(self, algorithm: str, ratings: dict[int, RatingRow]) -> None:
        """Save ratings for an algorithm.

        Values: (name, division, region, category, mu, sigma, matches_played, last_match_date).
        """
        updated_at = datetime.now(UTC).isoformat()
        for sid, (name, div, region, category, mu, sigma, played, last_date) in ratings.items():
            self.db.execute(
                """INSERT OR REPLACE INTO shooter_ratings
                   (algorithm, shooter_id, name, division, region, category, mu, sigma,
                    matches_played, last_match_date, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [algorithm, sid, name, div, region, category, mu, sigma, played,
                 last_date, updated_at],
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
    ) -> None:
        """Save a rating history snapshot after processing a match."""
        self.db.execute(
            """INSERT OR REPLACE INTO rating_history
               (algorithm, shooter_id, match_source, match_ct, match_id, match_date, mu, sigma)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [algorithm, shooter_id, match_source, match_ct, match_id, match_date, mu, sigma],
        )
