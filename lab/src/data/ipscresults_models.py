"""Pydantic models for the ipscresults.org OData JSON API.

API base: https://ipscresults.org/odata/
Full schema: https://ipscresults.org/odata/$metadata

These models represent the raw API responses. IpscResultsSyncer in ipscresults.py
converts them into the lab's canonical MatchResults format.
"""

from __future__ import annotations

from pydantic import BaseModel


class IpscMatch(BaseModel):
    """One entry from StatsMatchList."""

    id: str             # UUID, e.g. "92dbf246-be60-467e-8eb3-002203cfe617"
    name: str
    region_name: str | None = None
    date: str | None = None   # "YYYY-MM-DD"
    level: int = 0            # 3=National, 4=Continental, 5=World
    discipline: str | None = None
    state: int = 0            # 1 = results available


class IpscMatchDetail(BaseModel):
    """One entry from StatsMatchDetail({id})."""

    id: str
    name: str
    date: str | None = None
    level: int = 0
    state: int = 0
    discipline: str | None = None
    region: str | None = None
    region_code: str | None = None
    location: str | None = None
    finalized: bool = False
    modified: str | None = None


class IpscDivision(BaseModel):
    """One entry from Stats.DivisionList(id)."""

    division_code: int
    division: str
    total: int = 0
    url_path: str | None = None


class IpscStage(BaseModel):
    """One entry from Stats.StageList(id, div)."""

    id: int
    name: str
    course: str | None = None
    max_points: int = 0
    min_rounds: int = 0
    url_path: str | None = None


class IpscStageResult(BaseModel):
    """One entry from Stats.StageResult(id, div) — one row per competitor per stage."""

    rank: int
    competitor_number: int
    competitor_name: str
    competitor_alias: str | None = None
    region: str | None = None
    category: str | None = None
    squad_number: int = 0
    stage_number: int
    stage_time: float = 0.0
    score: int = 0
    hit_factor: float = 0.0
    stage_points: float = 0.0
    stage_percent: float = 0.0


class IpscCompetitor(BaseModel):
    """One entry from Stats.CompetitorList(id)."""

    id: int           # CompetitorNumber within the match
    name: str
    alias: str | None = None
    region_code: str | None = None
    power_factor: str | None = None
    category: str | None = None
    squad: str | None = None
    division: str
    division_code: int
    dq: bool = False
