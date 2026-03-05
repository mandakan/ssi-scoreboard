"""FastAPI rating server."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel

from src.data.store import Store


class RatingResponse(BaseModel):
    shooter_id: int
    name: str
    division: str | None
    mu: float
    sigma: float
    matches_played: int


class HealthResponse(BaseModel):
    status: str
    match_count: int


def create_app(db_path: Path = Path("data/lab.duckdb")) -> FastAPI:
    """Create the FastAPI application with a DuckDB-backed store."""
    app = FastAPI(title="SSI Rating Engine", version="0.1.0")
    store = Store(db_path)

    @app.get("/health")
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", match_count=store.get_match_count())

    @app.get("/ratings/{algorithm}")
    async def get_ratings(
        algorithm: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[RatingResponse]:
        """Get top ratings for an algorithm, sorted by mu descending."""
        rows = store.db.execute(
            """SELECT shooter_id, name, division, mu, sigma, matches_played
               FROM shooter_ratings
               WHERE algorithm = ?
               ORDER BY mu DESC
               LIMIT ? OFFSET ?""",
            [algorithm, limit, offset],
        ).fetchall()
        return [
            RatingResponse(
                shooter_id=r[0],
                name=r[1] or f"Shooter {r[0]}",
                division=r[2],
                mu=r[3],
                sigma=r[4],
                matches_played=r[5],
            )
            for r in rows
        ]

    @app.get("/ratings/{algorithm}/{shooter_id}")
    async def get_rating(algorithm: str, shooter_id: int) -> RatingResponse | None:
        """Get a specific shooter's rating."""
        row = store.db.execute(
            """SELECT shooter_id, name, division, mu, sigma, matches_played
               FROM shooter_ratings
               WHERE algorithm = ? AND shooter_id = ?""",
            [algorithm, shooter_id],
        ).fetchone()
        if not row:
            return None
        return RatingResponse(
            shooter_id=row[0],
            name=row[1] or f"Shooter {row[0]}",
            division=row[2],
            mu=row[3],
            sigma=row[4],
            matches_played=row[5],
        )

    @app.get("/history/{algorithm}/{shooter_id}")
    async def get_history(algorithm: str, shooter_id: int) -> list[dict[str, object]]:
        """Get rating history for a shooter."""
        rows = store.db.execute(
            """SELECT match_ct, match_id, match_date, mu, sigma
               FROM rating_history
               WHERE algorithm = ? AND shooter_id = ?
               ORDER BY match_date ASC NULLS LAST""",
            [algorithm, shooter_id],
        ).fetchall()
        return [
            {
                "match_ct": r[0],
                "match_id": r[1],
                "match_date": str(r[2]) if r[2] else None,
                "mu": r[3],
                "sigma": r[4],
            }
            for r in rows
        ]

    return app
