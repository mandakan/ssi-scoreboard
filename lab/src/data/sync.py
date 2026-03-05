"""HTTP sync client — pulls match data from the app's data API."""

from __future__ import annotations

import random
import time

import httpx
from rich.console import Console
from rich.progress import Progress

from src.data.models import (
    CompetitorMeta,
    MatchListResponse,
    MatchResults,
    MatchResultsMeta,
    StageMeta,
    StageResult,
)
from src.data.store import Store

console = Console()

# Default delay between individual match fetches (seconds)
DEFAULT_FETCH_DELAY = 2.0
DEFAULT_FETCH_JITTER = 1.0


class SyncClient:
    """Incremental sync client for pulling match data from the app."""

    def __init__(
        self,
        base_url: str,
        token: str,
        store: Store,
        *,
        delay: float = DEFAULT_FETCH_DELAY,
        jitter: float = DEFAULT_FETCH_JITTER,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.store = store
        self.delay = delay
        self.jitter = jitter
        self.client = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=60.0,
        )

    def close(self) -> None:
        self.client.close()

    def fetch_match_list(self, since: str | None = None) -> MatchListResponse:
        """Fetch the list of available matches from the app."""
        params: dict[str, str] = {"hasScorecard": "true"}
        if since:
            params["since"] = since
        resp = self.client.get("/api/data/matches", params=params)
        resp.raise_for_status()
        data = resp.json()
        # Convert camelCase keys to snake_case for Pydantic
        matches = []
        for m in data.get("matches", []):
            matches.append({
                "ct": m["ct"],
                "match_id": m["matchId"],
                "name": m["name"],
                "date": m.get("date"),
                "level": m.get("level"),
                "region": m.get("region"),
                "competitor_count": m.get("competitorCount", 0),
                "stage_count": m.get("stageCount", 0),
                "scoring_completed": m.get("scoringCompleted", 0),
                "stored_at": m.get("storedAt", ""),
                "has_scorecards": m.get("hasScorecards", False),
            })
        return MatchListResponse(matches=matches)  # type: ignore[arg-type]

    def fetch_match_results(self, ct: int, match_id: str) -> MatchResults:
        """Fetch full results for a single match."""
        resp = self.client.get(f"/api/data/match/{ct}/{match_id}/results")
        resp.raise_for_status()
        data = resp.json()

        meta_raw = data["meta"]
        meta = MatchResultsMeta(
            ct=meta_raw["ct"],
            match_id=meta_raw["matchId"],
            name=meta_raw["name"],
            date=meta_raw.get("date"),
            level=meta_raw.get("level"),
            region=meta_raw.get("region"),
            scoring_completed=meta_raw.get("scoringCompleted", 0),
        )

        stages = [
            StageMeta(
                stage_id=s["stageId"],
                stage_number=s["stageNumber"],
                stage_name=s["stageName"],
                max_points=s.get("maxPoints", 0),
            )
            for s in data.get("stages", [])
        ]

        competitors = [
            CompetitorMeta(
                competitor_id=c["competitorId"],
                shooter_id=c.get("shooterId"),
                name=c["name"],
                club=c.get("club"),
                division=c.get("division"),
            )
            for c in data.get("competitors", [])
        ]

        results = [
            StageResult(
                competitor_id=r["competitorId"],
                stage_id=r["stageId"],
                hit_factor=r.get("hitFactor"),
                points=r.get("points"),
                time=r.get("time"),
                max_points=r.get("maxPoints", 0),
                a_hits=r.get("aHits"),
                c_hits=r.get("cHits"),
                d_hits=r.get("dHits"),
                miss_count=r.get("missCount"),
                no_shoots=r.get("noShoots"),
                procedurals=r.get("procedurals"),
                dq=r.get("dq", False),
                dnf=r.get("dnf", False),
                zeroed=r.get("zeroed", False),
                overall_rank=r.get("overallRank"),
                overall_percent=r.get("overallPercent"),
                division_rank=r.get("divisionRank"),
                division_percent=r.get("divisionPercent"),
            )
            for r in data.get("results", [])
        ]

        return MatchResults(meta=meta, stages=stages, competitors=competitors, results=results)

    def sync(self, full: bool = False) -> int:
        """Run incremental (or full) sync. Returns number of new matches synced."""
        since = None if full else self.store.get_sync_watermark()

        console.print(
            f"[bold]Fetching match list[/bold] "
            f"({'full sync' if full else f'since {since}' if since else 'initial sync'})..."
        )
        listing = self.fetch_match_list(since=since)
        console.print(f"  Found {len(listing.matches)} matches with scorecards")

        # Filter out matches we already have
        new_matches = [
            m for m in listing.matches
            if not self.store.has_match(m.ct, m.match_id)
        ]
        console.print(f"  {len(new_matches)} new matches to sync")

        if not new_matches:
            console.print("[green]Already up to date.[/green]")
            return 0

        synced = 0
        with Progress(console=console) as progress:
            task = progress.add_task("Syncing matches...", total=len(new_matches))
            for m in new_matches:
                try:
                    results = self.fetch_match_results(m.ct, m.match_id)
                    self.store.store_match_results(results)
                    synced += 1
                    progress.update(task, advance=1, description=f"[green]{m.name}[/green]")
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 404:
                        # No scorecard data on SSI — record as known so we don't retry
                        self.store.skip_match(m.ct, m.match_id, m.name)
                        console.print(f"  [yellow]Skipped {m.name} (no data on SSI)[/yellow]")
                    else:
                        console.print(
                            f"  [red]Error fetching {m.name}: {e.response.status_code}[/red]"
                        )
                    progress.update(task, advance=1)
                except Exception as e:
                    console.print(f"  [red]Error processing {m.name}: {e}[/red]")
                    progress.update(task, advance=1)

                # Delay between requests (configurable via --delay)
                if self.delay > 0:
                    pause = self.delay + random.uniform(0, self.jitter)
                    time.sleep(pause)

        # Update watermark to the latest stored_at we saw
        if listing.matches:
            latest = max(m.stored_at for m in listing.matches if m.stored_at)
            if latest:
                self.store.set_sync_watermark(latest)

        console.print(f"[bold green]Synced {synced} new matches.[/bold green]")
        console.print(f"  Total matches in store: {self.store.get_match_count()}")
        return synced
