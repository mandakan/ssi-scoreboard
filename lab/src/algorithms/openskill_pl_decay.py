"""OpenSkill PlackettLuce with inactivity sigma decay.

Same as openskill (PlackettLuce), but a shooter's sigma (uncertainty) grows
proportionally to the number of days since their last match. A competitor who
hasn't competed recently is harder to predict, so their uncertainty increases
before their ratings are updated in the current match.

Decay concept adapted from Jonas Emilsson's ipsc-ranking project
(https://github.com/ipsc-ranking/ipsc-ranking.github.io, CC BY-NC-SA 4.0).
Only the algorithmic idea is borrowed; the implementation follows this project's
conventions and architecture.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from openskill.models import PlackettLuce

from src.algorithms.base import RatingAlgorithm
from src.data.models import Rating

# Sigma drift per inactive day. At 25/300 ≈ 0.083, a shooter absent for
# 30 days gains ~2.5 sigma; 100+ days drifts back to the default ceiling.
_TAU: float = 25.0 / 300
# Cap at OpenSkill's default sigma so decay never exceeds initial uncertainty.
_DEFAULT_SIGMA: float = 25.0 / 3


def _parse_date(date_str: str) -> date | None:
    """Parse the first 10 chars of a date string as an ISO date."""
    try:
        return date.fromisoformat(date_str[:10])
    except (ValueError, IndexError):
        return None


class OpenSkillPLDecay(RatingAlgorithm):
    """PlackettLuce with per-shooter inactivity sigma decay."""

    def __init__(self) -> None:
        self.model = PlackettLuce()
        self._ratings: dict[int, tuple[float, float]] = {}
        self._names: dict[int, str] = {}
        self._divisions: dict[int, str | None] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[int, int] = defaultdict(int)
        self._seen_matches: set[str] = set()
        # ISO date string of last match per shooter (for decay tracking).
        self._last_date: dict[int, str] = {}

    @property
    def name(self) -> str:
        return "openskill_pl_decay"

    def _get_rating(self, shooter_id: int) -> tuple[float, float]:
        if shooter_id not in self._ratings:
            r = self.model.rating()
            self._ratings[shooter_id] = (r.mu, r.sigma)
        return self._ratings[shooter_id]

    def _apply_decay(self, shooter_id: int, match_date_str: str) -> None:
        """Increase sigma based on days since last match, capped at default."""
        last_str = self._last_date.get(shooter_id)
        if last_str is None:
            return  # First appearance — no decay yet.

        match_d = _parse_date(match_date_str)
        last_d = _parse_date(last_str)
        if match_d is None or last_d is None:
            return

        days = (match_d - last_d).days
        if days <= 0:
            return

        mu, sigma = self._get_rating(shooter_id)
        self._ratings[shooter_id] = (mu, min(sigma + _TAU * days, _DEFAULT_SIGMA))

    def process_match_data(
        self,
        ct: int,
        match_id: str,
        match_date: str | None,
        stage_results: list[tuple[int, int, float | None, bool, bool, bool]],
        competitor_shooter_map: dict[int, int | None],
        *,
        name_map: dict[int, str] | None = None,
        division_map: dict[int, str | None] | None = None,
        region_map: dict[int, str | None] | None = None,
        category_map: dict[int, str | None] | None = None,
        match_level: str | None = None,
    ) -> None:
        match_key = f"{ct}:{match_id}"
        if match_key in self._seen_matches:
            return
        self._seen_matches.add(match_key)

        # Collect all shooters in this match, apply decay before rating.
        match_shooters: set[int] = set()
        for comp_id, _stage_id, _hf, _dq, dnf, _zeroed in stage_results:
            sid = competitor_shooter_map.get(comp_id)
            if sid is not None and not dnf:
                match_shooters.add(sid)

        if match_date:
            for sid in match_shooters:
                self._apply_decay(sid, match_date)

        by_stage: dict[int, list[tuple[int, float | None, bool, bool, bool]]] = defaultdict(list)
        for comp_id, stage_id, hf, dq, dnf, zeroed in stage_results:
            by_stage[stage_id].append((comp_id, hf, dq, dnf, zeroed))

        for _stage_id, stage_entries in by_stage.items():
            ranked: list[tuple[int, float]] = []
            for comp_id, hf, dq, dnf, zeroed in stage_entries:
                shooter_id = competitor_shooter_map.get(comp_id)
                if shooter_id is None or dnf:
                    continue
                effective_hf = 0.0 if (dq or zeroed) else (hf if hf is not None else 0.0)
                ranked.append((shooter_id, effective_hf))

            if len(ranked) < 2:
                continue

            ranked.sort(key=lambda x: x[1], reverse=True)

            teams = []
            ranks = []
            current_rank = 1
            for i, (sid, _) in enumerate(ranked):
                mu, sigma = self._get_rating(sid)
                r = self.model.rating(mu=mu, sigma=sigma)
                teams.append([r])
                if i > 0 and ranked[i][1] < ranked[i - 1][1]:
                    current_rank = i + 1
                ranks.append(current_rank)

            updated = self.model.rate(teams, ranks=[float(r) for r in ranks])

            for i, (sid, _) in enumerate(ranked):
                new_r = updated[i][0]
                self._ratings[sid] = (new_r.mu, new_r.sigma)

        # Update metadata and last-seen date after rating update.
        for comp_id, shooter_id in competitor_shooter_map.items():
            if shooter_id is None:
                continue
            if shooter_id in match_shooters:
                self._matches[shooter_id] += 1
                if match_date:
                    self._last_date[shooter_id] = match_date
            if name_map and comp_id in name_map:
                self._names[shooter_id] = name_map[comp_id]
            if division_map and comp_id in division_map:
                self._divisions[shooter_id] = division_map[comp_id]
            if region_map and comp_id in region_map:
                self._regions[shooter_id] = region_map[comp_id]
            if category_map and comp_id in category_map:
                self._categories[shooter_id] = category_map[comp_id]

    def get_ratings(self) -> dict[int, Rating]:
        result: dict[int, Rating] = {}
        for sid, (mu, sigma) in self._ratings.items():
            result[sid] = Rating(
                shooter_id=sid,
                name=self._names.get(sid, f"Shooter {sid}"),
                division=self._divisions.get(sid),
                region=self._regions.get(sid),
                category=self._categories.get(sid),
                mu=mu,
                sigma=sigma,
                matches_played=self._matches.get(sid, 0),
            )
        return result

    def predict_rank(self, shooter_ids: list[int]) -> list[int]:
        rated = [(sid, self._get_rating(sid)[0]) for sid in shooter_ids]
        rated.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in rated]

    def save_state(self, path: Path) -> None:
        state = {
            "ratings": {str(k): list(v) for k, v in self._ratings.items()},
            "matches": {str(k): v for k, v in self._matches.items()},
            "names": {str(k): v for k, v in self._names.items()},
            "divisions": {str(k): v for k, v in self._divisions.items()},
            "regions": {str(k): v for k, v in self._regions.items()},
            "categories": {str(k): v for k, v in self._categories.items()},
            "seen_matches": list(self._seen_matches),
            "last_date": dict(self._last_date),
        }
        path.write_text(json.dumps(state))

    def load_state(self, path: Path) -> None:
        state = json.loads(path.read_text())
        self._ratings = {int(k): (v[0], v[1]) for k, v in state["ratings"].items()}
        self._matches = defaultdict(int, {int(k): v for k, v in state["matches"].items()})
        self._names = {int(k): v for k, v in state.get("names", {}).items()}
        self._divisions = {int(k): v for k, v in state.get("divisions", {}).items()}
        self._regions = {int(k): v for k, v in state.get("regions", {}).items()}
        self._categories = {int(k): v for k, v in state.get("categories", {}).items()}
        self._seen_matches = set(state.get("seen_matches", []))
        self._last_date = {int(k): v for k, v in state.get("last_date", {}).items()}
