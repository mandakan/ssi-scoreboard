"""Pydantic models for match data and ratings."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class MatchMeta(BaseModel):
    """Match metadata from the listing endpoint."""

    ct: int
    match_id: str
    name: str
    date: str | None = None
    level: str | None = None
    region: str | None = None
    competitor_count: int = 0
    stage_count: int = 0
    scoring_completed: int = 0
    stored_at: str = ""
    has_scorecards: bool = False


class MatchListResponse(BaseModel):
    """Response from GET /api/data/matches."""

    matches: list[MatchMeta]


class StageMeta(BaseModel):
    """Stage metadata from the results endpoint."""

    stage_id: int
    stage_number: int
    stage_name: str
    max_points: int = 0


class CompetitorMeta(BaseModel):
    """Competitor metadata from the results endpoint."""

    competitor_id: int
    shooter_id: int | None = None
    name: str
    club: str | None = None
    division: str | None = None
    region: str | None = None
    region_display: str | None = None
    category: str | None = None


class StageResult(BaseModel):
    """Per-competitor per-stage result from the results endpoint."""

    competitor_id: int
    stage_id: int
    hit_factor: float | None = None
    points: float | None = None
    time: float | None = None
    max_points: int = 0
    a_hits: int | None = None
    c_hits: int | None = None
    d_hits: int | None = None
    miss_count: int | None = None
    no_shoots: int | None = None
    procedurals: int | None = None
    dq: bool = False
    dnf: bool = False
    zeroed: bool = False
    overall_rank: int | None = None
    overall_percent: float | None = None
    division_rank: int | None = None
    division_percent: float | None = None


class MatchResultsMeta(BaseModel):
    """Match-level metadata from the results endpoint."""

    ct: int
    match_id: str
    name: str
    date: str | None = None
    level: str | None = None
    region: str | None = None
    scoring_completed: int = 0


class MatchResults(BaseModel):
    """Full match results from GET /api/data/match/{ct}/{id}/results."""

    meta: MatchResultsMeta
    stages: list[StageMeta]
    competitors: list[CompetitorMeta]
    results: list[StageResult]


class Rating(BaseModel):
    """A single shooter's rating."""

    shooter_id: int
    name: str
    division: str | None = None
    region: str | None = None
    category: str | None = None
    mu: float
    sigma: float
    matches_played: int = 0
    last_match_date: datetime | None = None
