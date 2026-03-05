"""DuckDB local store for match data and ratings."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import duckdb

from src.data.models import MatchResults

DEFAULT_DB_PATH = Path("data/lab.duckdb")

SCHEMA_SQL = """
-- Sync state
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);

-- Match metadata
CREATE TABLE IF NOT EXISTS matches (
  ct INTEGER, match_id TEXT, name TEXT, date TIMESTAMP, level TEXT,
  region TEXT, competitor_count INTEGER, stage_count INTEGER,
  scoring_completed INTEGER, stored_at TIMESTAMP, synced_at TIMESTAMP,
  PRIMARY KEY (ct, match_id)
);

-- Competitors per match (with globally stable shooter_id)
CREATE TABLE IF NOT EXISTS competitors (
  ct INTEGER, match_id TEXT, competitor_id INTEGER,
  shooter_id INTEGER, name TEXT, club TEXT, division TEXT,
  PRIMARY KEY (ct, match_id, competitor_id)
);

-- Stage metadata
CREATE TABLE IF NOT EXISTS stages (
  ct INTEGER, match_id TEXT, stage_id INTEGER,
  stage_number INTEGER, stage_name TEXT, max_points INTEGER,
  PRIMARY KEY (ct, match_id, stage_id)
);

-- Per-competitor per-stage results (the main analytical table)
CREATE TABLE IF NOT EXISTS stage_results (
  ct INTEGER, match_id TEXT, competitor_id INTEGER, stage_id INTEGER,
  hit_factor DOUBLE, points DOUBLE, time DOUBLE, max_points INTEGER,
  a_hits INTEGER, c_hits INTEGER, d_hits INTEGER,
  miss_count INTEGER, no_shoots INTEGER, procedurals INTEGER,
  dq BOOLEAN, dnf BOOLEAN, zeroed BOOLEAN,
  overall_rank INTEGER, overall_percent DOUBLE,
  division_rank INTEGER, division_percent DOUBLE,
  PRIMARY KEY (ct, match_id, competitor_id, stage_id)
);

-- Rating results per algorithm
CREATE TABLE IF NOT EXISTS shooter_ratings (
  algorithm TEXT, shooter_id INTEGER, name TEXT, division TEXT,
  mu DOUBLE, sigma DOUBLE, matches_played INTEGER,
  last_match_date TIMESTAMP, updated_at TIMESTAMP,
  PRIMARY KEY (algorithm, shooter_id)
);

-- Rating history (snapshots after each match)
CREATE TABLE IF NOT EXISTS rating_history (
  algorithm TEXT, shooter_id INTEGER, match_ct INTEGER, match_id TEXT,
  match_date TIMESTAMP, mu DOUBLE, sigma DOUBLE,
  PRIMARY KEY (algorithm, shooter_id, match_ct, match_id)
);
"""


class Store:
    """DuckDB-backed local store for match data and ratings."""

    def __init__(self, db_path: Path = DEFAULT_DB_PATH) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = duckdb.connect(str(db_path))
        self.db.execute(SCHEMA_SQL)

    def close(self) -> None:
        self.db.close()

    def get_sync_watermark(self) -> str | None:
        """Get the last sync watermark (ISO date string)."""
        row = self.db.execute(
            "SELECT value FROM sync_state WHERE key = 'last_sync'"
        ).fetchone()
        return row[0] if row else None

    def set_sync_watermark(self, value: str) -> None:
        """Update the sync watermark."""
        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_sync', ?)",
            [value],
        )

    def has_match(self, ct: int, match_id: str) -> bool:
        """Check if a match is already in the store."""
        row = self.db.execute(
            "SELECT 1 FROM matches WHERE ct = ? AND match_id = ?",
            [ct, match_id],
        ).fetchone()
        return row is not None

    def skip_match(self, ct: int, match_id: str, name: str) -> None:
        """Record a match as known but without results (e.g. no scorecards on SSI).

        Prevents the sync from retrying it on every run.
        """
        synced_at = datetime.now(UTC).isoformat()
        self.db.execute(
            """INSERT OR IGNORE INTO matches
               (ct, match_id, name, date, level, region,
                competitor_count, stage_count, scoring_completed, synced_at)
               VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, 0, ?)""",
            [ct, match_id, name, synced_at],
        )

    def store_match_results(self, results: MatchResults) -> None:
        """Store a full match result set (metadata + competitors + stages + results)."""
        meta = results.meta
        synced_at = datetime.now(UTC).isoformat()

        # Upsert match metadata
        self.db.execute(
            """INSERT OR REPLACE INTO matches
               (ct, match_id, name, date, level, region,
                competitor_count, stage_count, scoring_completed, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                meta.ct, meta.match_id, meta.name,
                meta.date, meta.level, meta.region,
                len(results.competitors), len(results.stages),
                meta.scoring_completed, synced_at,
            ],
        )

        # Upsert competitors
        for c in results.competitors:
            self.db.execute(
                """INSERT OR REPLACE INTO competitors
                   (ct, match_id, competitor_id, shooter_id, name, club, division)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [meta.ct, meta.match_id, c.competitor_id, c.shooter_id, c.name, c.club, c.division],
            )

        # Upsert stages
        for s in results.stages:
            self.db.execute(
                """INSERT OR REPLACE INTO stages
                   (ct, match_id, stage_id, stage_number, stage_name, max_points)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [meta.ct, meta.match_id, s.stage_id, s.stage_number, s.stage_name, s.max_points],
            )

        # Upsert stage results
        for r in results.results:
            self.db.execute(
                """INSERT OR REPLACE INTO stage_results
                   (ct, match_id, competitor_id, stage_id,
                    hit_factor, points, time, max_points,
                    a_hits, c_hits, d_hits,
                    miss_count, no_shoots, procedurals,
                    dq, dnf, zeroed,
                    overall_rank, overall_percent,
                    division_rank, division_percent)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    meta.ct, meta.match_id, r.competitor_id, r.stage_id,
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

    def get_matches_chronological(self) -> list[tuple[int, str, str | None]]:
        """Return (ct, match_id, date) tuples sorted by date ascending."""
        rows = self.db.execute(
            "SELECT ct, match_id, date FROM matches ORDER BY date ASC NULLS LAST"
        ).fetchall()
        return [(r[0], r[1], str(r[2]) if r[2] else None) for r in rows]

    def get_stage_results_for_match(
        self, ct: int, match_id: str
    ) -> list[tuple[int, int, float | None, bool, bool, bool]]:
        """Return (competitor_id, stage_id, hit_factor, dq, dnf, zeroed) for a match."""
        rows = self.db.execute(
            """SELECT competitor_id, stage_id, hit_factor, dq, dnf, zeroed
               FROM stage_results WHERE ct = ? AND match_id = ?""",
            [ct, match_id],
        ).fetchall()
        return [(r[0], r[1], r[2], r[3], r[4], r[5]) for r in rows]

    def get_competitor_shooter_map(self, ct: int, match_id: str) -> dict[int, int | None]:
        """Return competitor_id → shooter_id mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, shooter_id FROM competitors WHERE ct = ? AND match_id = ?",
            [ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def get_competitor_division_map(self, ct: int, match_id: str) -> dict[int, str | None]:
        """Return competitor_id → division mapping for a match."""
        rows = self.db.execute(
            "SELECT competitor_id, division FROM competitors WHERE ct = ? AND match_id = ?",
            [ct, match_id],
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    def save_ratings(
        self,
        algorithm: str,
        ratings: dict[int, tuple[str, str | None, float, float, int, str | None]],
    ) -> None:
        """Save ratings for an algorithm.

        Values: (name, division, mu, sigma, matches_played, last_match_date).
        """
        updated_at = datetime.now(UTC).isoformat()
        for sid, (name, div, mu, sigma, played, last_date) in ratings.items():
            self.db.execute(
                """INSERT OR REPLACE INTO shooter_ratings
                   (algorithm, shooter_id, name, division, mu, sigma,
                    matches_played, last_match_date, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [algorithm, sid, name, div, mu, sigma, played, last_date, updated_at],
            )

    def save_rating_snapshot(
        self,
        algorithm: str,
        shooter_id: int,
        match_ct: int,
        match_id: str,
        match_date: str | None,
        mu: float,
        sigma: float,
    ) -> None:
        """Save a rating history snapshot after processing a match."""
        self.db.execute(
            """INSERT OR REPLACE INTO rating_history
               (algorithm, shooter_id, match_ct, match_id, match_date, mu, sigma)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [algorithm, shooter_id, match_ct, match_id, match_date, mu, sigma],
        )
