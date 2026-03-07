"""ipscresults.org OData client and syncer.

The ipscresults.org API is a public OData v4 endpoint — no authentication needed.
Base URL: https://ipscresults.org/odata/

Sync workflow:
  1. Fetch StatsMatchList (all matches, paginated)
  2. For each new match: fetch DivisionList
  3. For each division: fetch StageList + StageResult
  4. Merge into MatchResults and pass to Store

Note: per-stage A/C/D hit details require an additional CompetitorScore call per competitor
(one call per competitor, not per match). This is deferred to a future improvement — see
GitHub issue #226. For now, a_hits / c_hits / d_hits / miss_count / procedurals are NULL.
"""

from __future__ import annotations

import random
import time
from collections import defaultdict

import httpx
from rich.console import Console
from rich.progress import Progress

from src.data.identity import name_fingerprint, normalize_name
from src.data.ipscresults_models import (
    IpscCompetitor,
    IpscDivision,
    IpscMatch,
    IpscMatchDetail,
    IpscStage,
    IpscStageResult,
)
from src.data.models import (
    CompetitorMeta,
    MatchResults,
    MatchResultsMeta,
    StageMeta,
    StageResult,
)
from src.data.store import Store

console = Console()

_BASE_URL = "https://ipscresults.org/odata"

# ipscresults level codes → lab level strings
_LEVEL_MAP: dict[int, str] = {3: "l3", 4: "l4", 5: "l5"}

# Page size for paginated requests. 1254 total matches fit in 3 pages.
_PAGE_SIZE = 500

# Inter-match delay: one polite pause between matches; no sleep within a single match's
# fetch (get_divisions → get_competitors → per-division stage_list + stage_results are
# sequential calls for one unit of work and don't need individual rate-limiting).
DEFAULT_FETCH_DELAY = 0.3
DEFAULT_FETCH_JITTER = 0.1


class IpscResultsClient:
    """Thin HTTP wrapper around the ipscresults.org OData JSON API."""

    def __init__(
        self,
        *,
        delay: float = DEFAULT_FETCH_DELAY,
        jitter: float = DEFAULT_FETCH_JITTER,
        timeout: float = 30.0,
    ) -> None:
        self.delay = delay
        self.jitter = jitter
        self.client = httpx.Client(
            base_url=_BASE_URL,
            params={"$format": "json"},
            timeout=timeout,
        )

    def close(self) -> None:
        self.client.close()

    def _get(self, path: str, **params: str | int) -> dict:  # type: ignore[type-arg]
        resp = self.client.get(path, params={k: str(v) for k, v in params.items()})
        resp.raise_for_status()
        return resp.json()  # type: ignore[no-any-return]

    def _sleep(self) -> None:
        if self.delay > 0:
            time.sleep(self.delay + random.uniform(0, self.jitter))

    def get_match_list(
        self,
        level_min: int = 3,
        disciplines: set[str] | None = None,
    ) -> list[IpscMatch]:
        """Fetch all matches from StatsMatchList, paginated.

        disciplines: set of discipline names to include (e.g. {"Handgun", "Rifle"}).
                     Pass None (default) to include all disciplines.
        """
        matches: list[IpscMatch] = []
        skip = 0
        while True:
            data = self._get(
                "/StatsMatchList",
                **{"$top": str(_PAGE_SIZE), "$skip": str(skip), "$count": "true"},
            )
            total = data.get("@odata.count", 0)
            page = data.get("value", [])
            for raw in page:
                m = IpscMatch(
                    id=raw["ID"],
                    name=raw.get("Name") or "",
                    region_name=raw.get("RegionName"),
                    date=raw.get("Date"),
                    level=raw.get("Level", 0),
                    discipline=raw.get("Discipline"),
                    state=raw.get("State", 0),
                )
                level_ok = m.level >= level_min
                disc_ok = disciplines is None or (m.discipline or "") in disciplines
                if level_ok and disc_ok:
                    matches.append(m)
            skip += len(page)
            if skip >= total or not page:
                break
            self._sleep()
        return matches

    def get_match_detail(self, match_id: str) -> IpscMatchDetail | None:
        """Fetch StatsMatchDetail for one match. Returns None on 404."""
        try:
            data = self._get(f"/StatsMatchDetail({match_id})")
            rows = data.get("value", [])
            if not rows:
                return None
            r = rows[0]
            return IpscMatchDetail(
                id=r["ID"],
                name=r.get("Name") or "",
                date=r.get("Date"),
                level=r.get("Level", 0),
                state=r.get("State", 0),
                discipline=r.get("Discipline"),
                region=r.get("Region"),
                region_code=r.get("RegionCode"),
                location=r.get("Location"),
                finalized=r.get("Finaliazed", False),  # note: API typo
                modified=r.get("Modified"),
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def get_divisions(self, match_id: str) -> list[IpscDivision]:
        """Fetch Stats.DivisionList for a match."""
        data = self._get(f"/StatsMatchDetail/Stats.DivisionList(id={match_id})")
        return [
            IpscDivision(
                division_code=r["DivisionCode"],
                division=r.get("Division") or "",
                total=r.get("Total", 0),
                url_path=r.get("UrlPath"),
            )
            for r in data.get("value", [])
        ]

    def get_stage_list(self, match_id: str, div_code: int) -> list[IpscStage]:
        """Fetch Stats.StageList for a match + division."""
        data = self._get(f"/StatsMatchDetail/Stats.StageList(id={match_id},div={div_code})")
        return [
            IpscStage(
                id=r["ID"],
                name=r.get("Name") or f"Stage {r['ID']}",
                course=r.get("Course"),
                max_points=r.get("MaxPoints", 0),
                min_rounds=r.get("MinRounds", 0),
                url_path=r.get("UrlPath"),
            )
            for r in data.get("value", [])
        ]

    def get_stage_results(self, match_id: str, div_code: int) -> list[IpscStageResult]:
        """Fetch Stats.StageResult for a match + division — all competitors × stages."""
        data = self._get(f"/StatsMatchDetail/Stats.StageResult(id={match_id},div={div_code})")
        return [
            IpscStageResult(
                rank=r["Rank"],
                competitor_number=r["CompetitorNumber"],
                competitor_name=r.get("CompetitorName") or "",
                competitor_alias=r.get("CompetitorAlias"),
                region=r.get("Region"),
                category=r.get("Category"),
                squad_number=r.get("SquadNumber", 0),
                stage_number=r["StageNumber"],
                stage_time=r.get("StageTime", 0.0),
                score=r.get("Score", 0),
                hit_factor=r.get("HitFactor", 0.0),
                stage_points=r.get("StagePoints", 0.0),
                stage_percent=r.get("StagePercent", 0.0),
            )
            for r in data.get("value", [])
        ]

    def get_competitors(self, match_id: str) -> list[IpscCompetitor]:
        """Fetch Stats.CompetitorList for a match — competitor metadata including DQ status."""
        data = self._get(f"/StatsMatchDetail/Stats.CompetitorList(id={match_id})")
        return [
            IpscCompetitor(
                id=r["ID"],
                name=r.get("Name") or "",
                alias=r.get("Alias") or None,
                region_code=r.get("RegionCode"),
                power_factor=r.get("PowerFactor"),
                category=r.get("Category") or None,
                squad=r.get("Squad") or None,
                division=r.get("Division") or "",
                division_code=r.get("DivisionCode", 0),
                dq=r.get("DQ", False),
            )
            for r in data.get("value", [])
        ]


class IpscResultsSyncer:
    """Converts ipscresults OData responses into MatchResults and stores them.

    One IpscResultsSyncer instance manages the full sync loop:
    fetch match list → filter new → fetch each match's data → store.
    """

    def __init__(
        self,
        client: IpscResultsClient,
        store: Store,
        *,
        level_min: int = 3,
        disciplines: set[str] | None = None,
    ) -> None:
        self.client = client
        self.store = store
        self.level_min = level_min
        # None means all disciplines (no filter)
        self.disciplines = disciplines

    def sync(self, full: bool = False) -> int:
        """Sync matches from ipscresults.org. Returns number of new matches stored."""
        console.print("[bold]Fetching ipscresults match list...[/bold]")
        all_matches = self.client.get_match_list(
            level_min=self.level_min, disciplines=self.disciplines
        )
        disc_label = ", ".join(sorted(self.disciplines)) if self.disciplines else "all disciplines"
        console.print(
            f"  Found {len(all_matches)} matches (L{self.level_min}+, {disc_label})"
        )

        if not full:
            new_matches = [
                m for m in all_matches
                if not self.store.has_match("ipscresults", 0, m.id)
            ]
        else:
            new_matches = all_matches
        console.print(f"  {len(new_matches)} matches to sync")

        if not new_matches:
            console.print("[green]Already up to date.[/green]")
            return 0

        synced = 0
        skipped_errors = 0
        with Progress(console=console) as progress:
            task = progress.add_task("Syncing matches...", total=len(new_matches))
            for m in new_matches:
                try:
                    results = self._fetch_match(m)
                    if results is not None:
                        self.store.store_match_results(results)
                        synced += 1
                        progress.update(
                            task, advance=1, description=f"[green]{m.name}[/green]"
                        )
                    else:
                        # No usable data (empty divisions etc.) — record to skip next time.
                        self.store.skip_match("ipscresults", 0, m.id, m.name)
                        progress.update(task, advance=1, description=f"[yellow]{m.name}[/yellow]")
                except httpx.HTTPStatusError as e:
                    # Server-side error for this specific match (e.g. 500 on DivisionList).
                    # Record as skipped so we don't retry on every subsequent sync.
                    console.print(
                        f"  [yellow]HTTP {e.response.status_code} for {m.name} — skipping[/yellow]"
                    )
                    self.store.skip_match("ipscresults", 0, m.id, m.name)
                    skipped_errors += 1
                    progress.update(task, advance=1)
                except Exception as e:
                    # Unexpected error (network, parse failure) — log but don't skip,
                    # so we can retry on the next sync run.
                    console.print(f"  [red]Error fetching {m.name}: {e}[/red]")
                    progress.update(task, advance=1)
                self.client._sleep()

        # Watermark: most recent match date we've seen
        dates = [m.date for m in all_matches if m.date]
        if dates:
            self.store.set_sync_watermark(max(dates), source="ipscresults")

        msg = f"[bold green]Synced {synced} new ipscresults matches.[/bold green]"
        if skipped_errors:
            msg += f" [yellow]({skipped_errors} skipped due to server errors)[/yellow]"
        console.print(msg)
        return synced

    def _fetch_match(self, m: IpscMatch) -> MatchResults | None:
        """Fetch full data for one match and convert to MatchResults."""
        divisions = self.client.get_divisions(m.id)
        if not divisions:
            return None

        # Fetch all competitors for DQ status (shared across divisions)
        all_competitors = self.client.get_competitors(m.id)
        dq_map: dict[int, bool] = {c.id: c.dq for c in all_competitors}
        # Division per competitor_number (used to assign division to stage results)
        comp_division: dict[int, str] = {c.id: c.division for c in all_competitors}

        seen_stage_ids: set[int] = set()
        stage_metas: list[StageMeta] = []
        # competitor_number → CompetitorMeta (de-duped across divisions)
        competitor_metas: dict[int, CompetitorMeta] = {}
        # (competitor_number, stage_id) → StageResult
        stage_results: dict[tuple[int, int], StageResult] = {}

        for div in divisions:
            try:
                stages = self.client.get_stage_list(m.id, div.division_code)
                results = self.client.get_stage_results(m.id, div.division_code)
            except httpx.HTTPStatusError:
                continue  # skip divisions that fail

            # Collect stage metadata (stages are shared across divisions in the API
            # but each division call can return different stage subsets)
            for s in stages:
                if s.id not in seen_stage_ids:
                    seen_stage_ids.add(s.id)
                    stage_metas.append(
                        StageMeta(
                            stage_id=s.id,
                            stage_number=s.id,  # ipscresults stage IDs are sequential numbers
                            stage_name=s.name,
                            max_points=s.max_points,
                        )
                    )

            stage_max: dict[int, int] = {s.id: s.max_points for s in stages}

            # Group results by competitor_number to build per-competitor stage rows
            by_competitor: dict[int, list[IpscStageResult]] = defaultdict(list)
            by_stage: dict[int, list[IpscStageResult]] = defaultdict(list)
            for r in results:
                by_competitor[r.competitor_number].append(r)
                by_stage[r.stage_number].append(r)

            # Build per-stage overall rankings across this division
            for _stage_num, stage_rows in by_stage.items():
                sorted_rows = sorted(stage_rows, key=lambda x: x.hit_factor, reverse=True)
                winner_hf = sorted_rows[0].hit_factor if sorted_rows else 1.0
                for rank, row in enumerate(sorted_rows, start=1):
                    overall_pct = (row.hit_factor / winner_hf * 100.0) if winner_hf > 0 else 0.0
                    # stage_number == stage_id in ipscresults data
                    stage_id = row.stage_number
                    key = (row.competitor_number, stage_id)

                    # Create or update CompetitorMeta (once per competitor_number)
                    if row.competitor_number not in competitor_metas:
                        display_name = normalize_name(row.competitor_name, "ipscresults")
                        region = row.region or ""
                        fp = name_fingerprint(display_name, region)
                        competitor_metas[row.competitor_number] = CompetitorMeta(
                            competitor_id=row.competitor_number,
                            shooter_id=None,
                            identity_key=fp,
                            name=display_name,
                            division=comp_division.get(row.competitor_number, div.division),
                            region=row.region,
                            category=row.category if row.category else None,
                        )

                    stage_results[key] = StageResult(
                        competitor_id=row.competitor_number,
                        stage_id=stage_id,
                        hit_factor=row.hit_factor,
                        points=float(row.score),
                        time=row.stage_time,
                        max_points=stage_max.get(stage_id, 0),
                        dq=dq_map.get(row.competitor_number, False),
                        dnf=False,   # ipscresults StageResult doesn't expose DNF explicitly
                        zeroed=row.hit_factor == 0.0 and row.stage_time == 0.0,
                        overall_rank=rank,
                        overall_percent=round(overall_pct, 2),
                        division_rank=row.rank,
                        division_percent=row.stage_percent,
                    )

        if not stage_metas or not competitor_metas:
            return None

        level_str = _LEVEL_MAP.get(m.level)
        meta = MatchResultsMeta(
            ct=0,
            match_id=m.id,
            name=m.name,
            date=m.date,
            level=level_str,
            region=m.region_name,
            scoring_completed=100,
            source="ipscresults",
        )
        return MatchResults(
            meta=meta,
            stages=sorted(stage_metas, key=lambda s: s.stage_id),
            competitors=list(competitor_metas.values()),
            results=list(stage_results.values()),
        )
