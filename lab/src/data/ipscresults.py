"""ipscresults.org OData client and syncer.

The ipscresults.org API is a public OData v4 endpoint — no authentication needed.
Base URL: https://ipscresults.org/odata/

Sync workflow:
  1. Fetch StatsMatchList (all matches, paginated)
  2. For each new match: fetch DivisionList
  3. For each division: fetch StageList + StageResult
  4. Merge into MatchResults and pass to Store

Raw bundle cache:
  When a RawMatchStore is configured (see raw_store.py), each match's complete
  OData API responses are persisted as a gzip-compressed JSON file before being
  parsed into MatchResults.  Subsequent syncs (or re-syncs with --full) load from
  the bundle cache instead of hitting the remote API, making re-processing instant.

Note: per-stage A/C/D hit details require an additional CompetitorScore call per competitor
(one call per competitor, not per match). This is deferred to a future improvement — see
GitHub issue #226. For now, a_hits / c_hits / d_hits / miss_count / procedurals are NULL.
"""

from __future__ import annotations

import random
import time
from collections import defaultdict
from datetime import UTC, datetime

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
from src.data.raw_store import BUNDLE_SCHEMA_VERSION, BundleSource, RawMatchStore
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

    # ------------------------------------------------------------------
    # Public API — return parsed Pydantic models
    # ------------------------------------------------------------------

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
        return self._parse_divisions(data.get("value", []))

    def get_stage_list(self, match_id: str, div_code: int) -> list[IpscStage]:
        """Fetch Stats.StageList for a match + division."""
        data = self._get(f"/StatsMatchDetail/Stats.StageList(id={match_id},div={div_code})")
        return self._parse_stages(data.get("value", []))

    def get_stage_results(self, match_id: str, div_code: int) -> list[IpscStageResult]:
        """Fetch Stats.StageResult for a match + division — all competitors × stages."""
        data = self._get(f"/StatsMatchDetail/Stats.StageResult(id={match_id},div={div_code})")
        return self._parse_stage_results(data.get("value", []))

    def get_competitors(self, match_id: str) -> list[IpscCompetitor]:
        """Fetch Stats.CompetitorList for a match — competitor metadata including DQ status."""
        data = self._get(f"/StatsMatchDetail/Stats.CompetitorList(id={match_id})")
        return self._parse_competitors(data.get("value", []))

    # ------------------------------------------------------------------
    # Raw bundle fetch — returns serialisable OData value arrays
    # ------------------------------------------------------------------

    def fetch_raw_bundle(self, match_id: str) -> dict | None:  # type: ignore[type-arg]
        """Fetch all OData responses for one match and return as a raw JSON-serialisable dict.

        Returns None when there are no usable divisions (same semantics as
        _fetch_match returning None).  Per-division HTTP errors are silently
        skipped (same behaviour as the existing sync loop).

        The returned dict has schema_version == BUNDLE_SCHEMA_VERSION and
        contains the unmodified OData ``value`` arrays so that new fields can
        be extracted from stored files without re-fetching from the API.
        """
        div_data = self._get(f"/StatsMatchDetail/Stats.DivisionList(id={match_id})")
        div_items: list[dict] = div_data.get("value", [])  # type: ignore[type-arg]
        if not div_items:
            return None

        comp_data = self._get(f"/StatsMatchDetail/Stats.CompetitorList(id={match_id})")
        comp_items: list[dict] = comp_data.get("value", [])  # type: ignore[type-arg]

        per_division: dict[str, dict] = {}  # type: ignore[type-arg]
        for div_raw in div_items:
            div_code = div_raw.get("DivisionCode", 0)
            try:
                stage_data = self._get(
                    f"/StatsMatchDetail/Stats.StageList(id={match_id},div={div_code})"
                )
                result_data = self._get(
                    f"/StatsMatchDetail/Stats.StageResult(id={match_id},div={div_code})"
                )
            except httpx.HTTPStatusError:
                continue  # skip divisions that fail — same as existing sync loop
            per_division[str(div_code)] = {
                "stages": stage_data.get("value", []),
                "results": result_data.get("value", []),
            }

        if not per_division:
            return None

        return {
            "schema_version": BUNDLE_SCHEMA_VERSION,
            "match_id": match_id,
            "fetched_at": datetime.now(UTC).isoformat(),
            "competitors": comp_items,
            "divisions": div_items,
            "per_division": per_division,
        }

    # ------------------------------------------------------------------
    # Static OData item → Pydantic parsers
    # Shared by the get_X() methods and _parse_bundle() to avoid duplicating
    # the PascalCase→snake_case field mapping.
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_divisions(items: list[dict]) -> list[IpscDivision]:  # type: ignore[type-arg]
        return [
            IpscDivision(
                division_code=r["DivisionCode"],
                division=r.get("Division") or "",
                total=r.get("Total", 0),
                url_path=r.get("UrlPath"),
            )
            for r in items
        ]

    @staticmethod
    def _parse_stages(items: list[dict]) -> list[IpscStage]:  # type: ignore[type-arg]
        return [
            IpscStage(
                id=r["ID"],
                name=r.get("Name") or f"Stage {r['ID']}",
                course=r.get("Course"),
                max_points=r.get("MaxPoints", 0),
                min_rounds=r.get("MinRounds", 0),
                url_path=r.get("UrlPath"),
            )
            for r in items
        ]

    @staticmethod
    def _parse_stage_results(items: list[dict]) -> list[IpscStageResult]:  # type: ignore[type-arg]
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
            for r in items
        ]

    @staticmethod
    def _parse_competitors(items: list[dict]) -> list[IpscCompetitor]:  # type: ignore[type-arg]
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
            for r in items
        ]


class IpscResultsSyncer:
    """Converts ipscresults OData responses into MatchResults and stores them.

    One IpscResultsSyncer instance manages the full sync loop:
    fetch match list → filter new → fetch each match's data → store.

    When ``raw_store`` is provided, each match's raw OData bundle is persisted
    before parsing.  On subsequent runs (including ``--full`` re-syncs), the
    bundle is loaded from the store instead of hitting the remote API.
    """

    def __init__(
        self,
        client: IpscResultsClient,
        store: Store,
        *,
        level_min: int = 3,
        disciplines: set[str] | None = None,
        raw_store: RawMatchStore | None = None,
    ) -> None:
        self.client = client
        self.store = store
        self.level_min = level_min
        # None means all disciplines (no filter)
        self.disciplines = disciplines
        self.raw_store = raw_store

    def sync(self, full: bool = False, raw_only: bool = False) -> int:
        """Sync matches from ipscresults.org. Returns number of matches processed.

        raw_only=True skips DuckDB writes entirely — it only fetches and caches
        raw bundles for matches not yet stored locally.  The bundle files act as
        the resume checkpoint: restart at any time and it picks up from the first
        missing file.  Run a normal sync afterwards to parse into DuckDB.
        """
        console.print("[bold]Fetching ipscresults match list...[/bold]")
        all_matches = self.client.get_match_list(
            level_min=self.level_min, disciplines=self.disciplines
        )
        disc_label = ", ".join(sorted(self.disciplines)) if self.disciplines else "all disciplines"
        console.print(
            f"  Found {len(all_matches)} matches (L{self.level_min}+, {disc_label})"
        )

        if self.raw_store is not None:
            cached = self.raw_store.local_count()
            console.print(
                f"  Bundle cache:  {self.raw_store.local_dir}  "
                f"({cached} files stored locally)"
            )
            if self.raw_store.s3_configured:
                console.print(
                    f"                 {self.raw_store.s3_location}  "
                    f"[green](S3/R2 sync enabled — bundles pushed after each fetch)[/green]"
                )
            else:
                console.print(
                    "                 S3/R2: [yellow]not configured[/yellow]"
                    " — set LAB_S3_BUCKET to enable remote sync"
                )
        else:
            console.print(
                "  Bundle cache:  [yellow]disabled[/yellow]"
                " — set --raw-dir to cache raw OData responses"
            )

        if raw_only:
            # Only fetch bundles not yet cached locally — has_local() is the checkpoint.
            if self.raw_store is None:
                console.print("[red]--raw-only requires --raw-dir to be set.[/red]")
                return 0
            new_matches = [m for m in all_matches if not self.raw_store.has_local(m.id)]
            console.print(f"  {len(new_matches)} bundles to download (raw-only mode)")
        elif not full:
            stored_ids = self.store.get_stored_match_ids("ipscresults")
            new_matches = [m for m in all_matches if m.id not in stored_ids]
            console.print(f"  {len(new_matches)} matches to sync")
        else:
            new_matches = all_matches
            console.print(f"  {len(new_matches)} matches to sync")

        if not new_matches:
            console.print("[green]Already up to date.[/green]")
            return 0

        synced = 0
        skipped_errors = 0
        source_counts: dict[BundleSource, int] = {"local": 0, "s3": 0, "api": 0}
        _source_style: dict[BundleSource, str] = {
            "local": "dim cyan",
            "s3":    "dim blue",
            "api":   "dim yellow",
        }

        with Progress(console=console) as progress:
            task_label = "Downloading bundles..." if raw_only else "Syncing matches..."
            task = progress.add_task(task_label, total=len(new_matches))
            for m in new_matches:
                src: BundleSource = "api"
                try:
                    if raw_only:
                        # Fetch and cache only — no parse, no DuckDB write.
                        bundle = self.client.fetch_raw_bundle(m.id)
                        if bundle is not None:
                            self.raw_store.save(m.id, bundle)  # type: ignore[union-attr]
                            synced += 1
                            src = "api"
                        src_tag = f"[{_source_style[src]}]({src})[/{_source_style[src]}]"
                        source_counts[src] += 1
                        desc = (
                            f"[green]{m.name}[/green] {src_tag}"
                            if bundle else f"[yellow]{m.name}[/yellow]"
                        )
                        progress.update(task, advance=1, description=desc)
                        self.client._sleep()
                    else:
                        results, src = self._fetch_match(m)
                        source_counts[src] += 1
                        src_tag = f"[{_source_style[src]}]({src})[/{_source_style[src]}]"
                        if results is not None:
                            self.store.store_match_results(results)
                            synced += 1
                            progress.update(
                                task, advance=1,
                                description=f"[green]{m.name}[/green] {src_tag}",
                            )
                        else:
                            # No usable data (empty divisions etc.) — record to skip next time.
                            self.store.skip_match(
                                "ipscresults", 0, m.id, m.name, reason="no divisions or results"
                            )
                            progress.update(
                                task, advance=1,
                                description=f"[yellow]{m.name}[/yellow] {src_tag}",
                            )
                        if src == "api":
                            self.client._sleep()
                except httpx.HTTPStatusError as e:
                    reason = f"HTTP {e.response.status_code}: {e.request.url}"
                    console.print(
                        f"  [yellow]HTTP {e.response.status_code} for {m.name} — skipping[/yellow]"
                    )
                    if not raw_only:
                        self.store.skip_match("ipscresults", 0, m.id, m.name, reason=reason)
                    skipped_errors += 1
                    progress.update(task, advance=1)
                except Exception as e:
                    console.print(f"  [red]Error fetching {m.name}: {e}[/red]")
                    progress.update(task, advance=1)

        if not raw_only:
            # Watermark: most recent match date we've seen
            dates = [m.date for m in all_matches if m.date]
            if dates:
                self.store.set_sync_watermark(max(dates), source="ipscresults")

        if raw_only:
            parts = [f"[bold green]Downloaded {synced} raw bundles.[/bold green]"]
            parts.append("[dim]Run sync-ipscresults to parse into DuckDB.[/dim]")
        else:
            parts = [f"[bold green]Synced {synced} ipscresults matches.[/bold green]"]
            _ordered: list[BundleSource] = ["local", "s3", "api"]
            tally = ", ".join(
                f"{source_counts[s]} {s}"
                for s in _ordered
                if source_counts[s]
            )
            if tally:
                parts.append(f"[dim]({tally})[/dim]")
        if skipped_errors:
            parts.append(f"[yellow]({skipped_errors} skipped due to errors)[/yellow]")
        console.print(" ".join(parts))
        return synced

    def _fetch_match(self, m: IpscMatch) -> tuple[MatchResults | None, BundleSource]:
        """Load or fetch the raw bundle for ``m``, then parse it into MatchResults.

        Tier 1 — local file: instant, no network.
        Tier 2 — S3/R2: download + cache locally, then parse.
        Tier 3 — API: fetch fresh OData, save to raw_store, parse.

        Returns (results, source) so callers can show which tier served the data.
        """
        if self.raw_store is not None:
            was_local = self.raw_store.has_local(m.id)
            bundle = self.raw_store.load(m.id)
            if bundle is not None:
                source: BundleSource = "local" if was_local else "s3"
                return self._parse_bundle(m, bundle), source

        bundle = self.client.fetch_raw_bundle(m.id)
        if bundle is None:
            return None, "api"

        if self.raw_store is not None:
            self.raw_store.save(m.id, bundle)

        return self._parse_bundle(m, bundle), "api"

    def _parse_bundle(self, m: IpscMatch, bundle: dict) -> MatchResults | None:  # type: ignore[type-arg]
        """Convert a raw OData bundle into a MatchResults object.

        This is the same transformation logic as the previous _fetch_match,
        now operating on pre-fetched (and possibly cached) raw API responses.
        """
        divisions = IpscResultsClient._parse_divisions(bundle.get("divisions", []))
        if not divisions:
            return None

        all_competitors = IpscResultsClient._parse_competitors(bundle.get("competitors", []))
        dq_map: dict[int, bool] = {c.id: c.dq for c in all_competitors}
        comp_division: dict[int, str] = {c.id: c.division for c in all_competitors}
        alias_map: dict[int, str | None] = {c.id: c.alias for c in all_competitors}

        per_division_raw: dict[str, dict] = bundle.get("per_division", {})  # type: ignore[type-arg]

        seen_stage_ids: set[int] = set()
        stage_metas: list[StageMeta] = []
        competitor_metas: dict[int, CompetitorMeta] = {}
        stage_results: dict[tuple[int, int], StageResult] = {}

        for div in divisions:
            div_data = per_division_raw.get(str(div.division_code), {})
            stages = IpscResultsClient._parse_stages(div_data.get("stages", []))
            results = IpscResultsClient._parse_stage_results(div_data.get("results", []))

            if not stages or not results:
                continue

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

            by_competitor: dict[int, list[IpscStageResult]] = defaultdict(list)
            by_stage: dict[int, list[IpscStageResult]] = defaultdict(list)
            for r in results:
                by_competitor[r.competitor_number].append(r)
                by_stage[r.stage_number].append(r)

            for _stage_num, stage_rows in by_stage.items():
                sorted_rows = sorted(stage_rows, key=lambda x: x.hit_factor, reverse=True)
                winner_hf = sorted_rows[0].hit_factor if sorted_rows else 1.0
                for rank, row in enumerate(sorted_rows, start=1):
                    overall_pct = (row.hit_factor / winner_hf * 100.0) if winner_hf > 0 else 0.0
                    stage_id = row.stage_number  # stage_number == stage_id in ipscresults data
                    key = (row.competitor_number, stage_id)

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
                            alias=alias_map.get(row.competitor_number),
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
            discipline=m.discipline,
            scoring_completed=100,
            source="ipscresults",
        )
        return MatchResults(
            meta=meta,
            stages=sorted(stage_metas, key=lambda s: s.stage_id),
            competitors=list(competitor_metas.values()),
            results=list(stage_results.values()),
        )
