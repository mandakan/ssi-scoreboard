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
    region: str | None
    category: str | None
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
        division: str | None = None,
        region: str | None = None,
        category: str | None = None,
    ) -> list[RatingResponse]:
        """Get top ratings for an algorithm, sorted by mu descending."""
        filters = ["algorithm = ?"]
        params: list[object] = [algorithm]
        if division:
            filters.append("division = ?")
            params.append(division)
        if region:
            filters.append("region = ?")
            params.append(region)
        if category:
            filters.append("category = ?")
            params.append(category)
        where = " AND ".join(filters)
        rows = store.db.execute(
            f"SELECT shooter_id, name, division, region, category, mu, sigma, matches_played "
            f"FROM shooter_ratings WHERE {where} ORDER BY mu DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [
            RatingResponse(
                shooter_id=r[0],
                name=r[1] or f"Shooter {r[0]}",
                division=r[2],
                region=r[3],
                category=r[4],
                mu=r[5],
                sigma=r[6],
                matches_played=r[7],
            )
            for r in rows
        ]

    @app.get("/ratings/{algorithm}/{shooter_id}")
    async def get_rating(algorithm: str, shooter_id: int) -> RatingResponse | None:
        """Get a specific shooter's rating."""
        row = store.db.execute(
            """SELECT shooter_id, name, division, region, category, mu, sigma, matches_played
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
            region=row[3],
            category=row[4],
            mu=row[5],
            sigma=row[6],
            matches_played=row[7],
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
