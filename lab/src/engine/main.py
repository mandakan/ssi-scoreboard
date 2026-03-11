"""FastAPI rating server."""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.data.store import Store

# z-score for the 70th percentile conservative rating: mu - z*sigma.
_CONS_Z = 0.5244005122401781


class RatingResponse(BaseModel):
    shooter_id: int
    name: str
    division: str | None
    region: str | None
    category: str | None
    mu: float
    sigma: float
    conservative_rating: float  # mu - 0.5244 * sigma (70th percentile)
    matches_played: int
    last_match_date: str | None


class TeamSelectEntry(BaseModel):
    shooter_id: int
    name: str
    region: str | None
    category: str | None
    division: str
    mu: float
    sigma: float
    conservative_rating: float
    matches_played: int
    last_match_date: str | None


class TeamSelectResponse(BaseModel):
    algorithm: str
    region: str
    sort: str
    min_matches: int
    active_since: str | None
    min_recent_matches: int
    recent_since: str | None
    top_n: int
    divisions: dict[str, list[TeamSelectEntry]]


class HealthResponse(BaseModel):
    status: str
    match_count: int


def _order_by(sort: str) -> str:
    if sort == "conservative":
        return f"(mu - {_CONS_Z} * sigma) DESC"
    return "mu DESC"


def _build_rating(row: Any) -> RatingResponse:
    mu = float(row[5])
    sigma = float(row[6])
    # division column uses '' as sentinel for cross-division (None) ratings
    raw_div = str(row[2]) if row[2] else None
    return RatingResponse(
        shooter_id=int(row[0]),
        name=str(row[1]) if row[1] else f"Shooter {row[0]}",
        division=raw_div if raw_div else None,
        region=str(row[3]) if row[3] else None,
        category=str(row[4]) if row[4] else None,
        mu=mu,
        sigma=sigma,
        conservative_rating=mu - _CONS_Z * sigma,
        matches_played=int(row[7]),
        last_match_date=str(row[8]) if row[8] else None,
    )


def create_app(db_path: Path = Path("data/lab.duckdb")) -> FastAPI:
    """Create the FastAPI application with a DuckDB-backed store."""
    app = FastAPI(title="SSI Rating Engine", version="0.2.0")
    store = Store(db_path)

    @app.get("/health")
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", match_count=store.get_match_count())

    @app.get("/ratings/{algorithm}")
    async def get_ratings(
        algorithm: str,
        sort: str = Query("mu", description="Sort order: 'mu' or 'conservative'"),
        limit: int = Query(50, ge=1, le=500),
        offset: int = Query(0, ge=0),
        division: str | None = None,
        region: str | None = None,
        category: str | None = None,
        min_matches: int = Query(0, ge=0, description="Minimum matches played (career total)"),
        active_since: str | None = Query(
            None, description="Only include shooters active on or after this date (YYYY-MM-DD)"
        ),
        min_recent_matches: int = Query(
            0, ge=0, description="Minimum matches played since recent_since"
        ),
        recent_since: str | None = Query(
            None,
            description=(
                "Window start date for min_recent_matches filter (YYYY-MM-DD). "
                "Only effective when min_recent_matches > 0."
            ),
        ),
    ) -> list[RatingResponse]:
        """Get ratings for an algorithm with optional filtering and sorting.

        - **sort**: `mu` (default) or `conservative` (mu − 0.52×σ, penalises low match counts)
        - **min_matches**: exclude shooters with fewer career matches than this threshold
        - **active_since**: ISO date — exclude shooters whose last match was before this date
        - **min_recent_matches** + **recent_since**: require at least N matches since a date
        """
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
        if min_matches > 0:
            filters.append("matches_played >= ?")
            params.append(min_matches)
        if active_since:
            filters.append("last_match_date >= ?")
            params.append(active_since)
        if min_recent_matches > 0 and recent_since:
            filters.append(
                "(SELECT COUNT(*) FROM rating_history rh"
                " WHERE rh.algorithm = shooter_ratings.algorithm"
                " AND rh.shooter_id = shooter_ratings.shooter_id"
                " AND rh.division = shooter_ratings.division"
                " AND rh.match_date >= ?) >= ?"
            )
            params.extend([recent_since, min_recent_matches])

        order = _order_by(sort)
        where = " AND ".join(filters)
        rows = store.db.execute(
            f"SELECT shooter_id, name, division, region, category, mu, sigma, "
            f"matches_played, last_match_date "
            f"FROM shooter_ratings WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        return [_build_rating(r) for r in rows]

    @app.get("/ratings/{algorithm}/{shooter_id}")
    async def get_rating(algorithm: str, shooter_id: int) -> RatingResponse | None:
        """Get a specific shooter's rating."""
        row = store.db.execute(
            """SELECT shooter_id, name, division, region, category, mu, sigma,
                      matches_played, last_match_date
               FROM shooter_ratings
               WHERE algorithm = ? AND shooter_id = ?""",
            [algorithm, shooter_id],
        ).fetchone()
        if not row:
            return None
        return _build_rating(row)

    @app.get("/team-select/{algorithm}")
    async def team_select(
        algorithm: str,
        region: str = Query(..., description="Region code to filter by, e.g. 'SWE'"),
        top_n: int = Query(6, ge=1, le=20, description="Number of shooters to return per division"),
        sort: str = Query(
            "conservative",
            description="Sort order within each division: 'mu' or 'conservative'",
        ),
        min_matches: int = Query(3, ge=0, description="Minimum career matches to be eligible"),
        active_since: str | None = Query(
            None,
            description=(
                "Exclude shooters whose last match was before this date (YYYY-MM-DD). "
                "E.g. '2024-01-01' to require at least one result since 2024."
            ),
        ),
        min_recent_matches: int = Query(
            0, ge=0, description="Minimum matches played since recent_since"
        ),
        recent_since: str | None = Query(
            None,
            description=(
                "Window start date for min_recent_matches filter (YYYY-MM-DD). "
                "Only effective when min_recent_matches > 0."
            ),
        ),
    ) -> TeamSelectResponse:
        """Return top-N candidates per division for national team selection.

        Fetches all rated shooters for the given region, applies eligibility filters,
        groups by division, and returns the top_n per division sorted by the chosen
        ranking method.

        Recommended settings for World Shoot selection:
        - sort=conservative (rewards consistency, penalises low match counts)
        - min_matches=3 (require meaningful competitive history)
        - active_since=2024-01-01 (require recent activity)
        - min_recent_matches=2&recent_since=2024-01-01 (require N results in the window)
        """
        filters = ["algorithm = ?", "region = ?", "division != ''"]
        params: list[object] = [algorithm, region]

        if min_matches > 0:
            filters.append("matches_played >= ?")
            params.append(min_matches)
        if active_since:
            filters.append("last_match_date >= ?")
            params.append(active_since)
        if min_recent_matches > 0 and recent_since:
            filters.append(
                "(SELECT COUNT(*) FROM rating_history rh"
                " WHERE rh.algorithm = shooter_ratings.algorithm"
                " AND rh.shooter_id = shooter_ratings.shooter_id"
                " AND rh.division = shooter_ratings.division"
                " AND rh.match_date >= ?) >= ?"
            )
            params.extend([recent_since, min_recent_matches])

        order = _order_by(sort)
        where = " AND ".join(filters)

        rows = store.db.execute(
            f"SELECT shooter_id, name, division, region, category, mu, sigma, "
            f"matches_played, last_match_date "
            f"FROM shooter_ratings WHERE {where} ORDER BY division, {order}",
            params,
        ).fetchall()

        # Group by division and take top_n from each (already sorted within division).
        by_division: dict[str, list[TeamSelectEntry]] = defaultdict(list)
        for row in rows:
            div = str(row[2])
            if len(by_division[div]) >= top_n:
                continue
            mu = float(row[5])
            sigma = float(row[6])
            by_division[div].append(
                TeamSelectEntry(
                    shooter_id=int(row[0]),
                    name=str(row[1]) if row[1] else f"Shooter {row[0]}",
                    division=div,
                    region=str(row[3]) if row[3] else None,
                    category=str(row[4]) if row[4] else None,
                    mu=mu,
                    sigma=sigma,
                    conservative_rating=mu - _CONS_Z * sigma,
                    matches_played=int(row[7]),
                    last_match_date=str(row[8]) if row[8] else None,
                )
            )

        return TeamSelectResponse(
            algorithm=algorithm,
            region=region,
            sort=sort,
            min_matches=min_matches,
            active_since=active_since,
            min_recent_matches=min_recent_matches,
            recent_since=recent_since,
            top_n=top_n,
            divisions=dict(by_division),
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

    class IdentityDecisionRequest(BaseModel):
        source: str
        source_key: str

    @app.post("/identity/approve")
    async def approve_identity(req: IdentityDecisionRequest) -> dict[str, str]:
        """Mark an auto-fuzzy identity link as human-approved (correct match)."""
        row = store.db.execute(
            "SELECT 1 FROM shooter_identity_links"
            " WHERE source = ? AND source_key = ? AND method = 'auto_fuzzy'",
            [req.source, req.source_key],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Auto-fuzzy link not found")
        store.mark_identity_reviewed(req.source, req.source_key, "approved")
        return {"status": "ok"}

    @app.post("/identity/reject")
    async def reject_identity(req: IdentityDecisionRequest) -> dict[str, object]:
        """Reject an auto-fuzzy link: split into a new manual identity.

        Allocates a fresh canonical_id for the ipscresults shooter, creates a manual
        link (so future `rating link` runs never re-merge this pair), and records the
        rejection decision in identity_reviews.
        """
        row = store.db.execute(
            "SELECT 1 FROM shooter_identity_links"
            " WHERE source = ? AND source_key = ? AND method = 'auto_fuzzy'",
            [req.source, req.source_key],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Auto-fuzzy link not found")
        new_id = store.reject_identity_link(req.source, req.source_key)
        store.mark_identity_reviewed(req.source, req.source_key, "rejected")
        return {"status": "ok", "new_canonical_id": new_id}

    # Serve the static explorer if site/ exists alongside the API.
    # Routes defined above take precedence; StaticFiles only handles the rest.
    _site = Path("site")
    if _site.exists():
        app.mount("/", StaticFiles(directory=str(_site), html=True), name="static")

    return app
