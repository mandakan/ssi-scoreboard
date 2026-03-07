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

from src.algorithms.base import (
    DivKey,
    RatingAlgorithm,
    decode_div_key,
    encode_div_key,
    group_stage_by_division,
)
from src.data.models import Rating

# Sigma drift per inactive day. At 25/300 ≈ 0.083, a shooter absent for
# 30 days gains ~2.5 sigma; 100+ days drifts back to the default ceiling.
_TAU: float = 25.0 / 300
# Cap at OpenSkill's default sigma so decay never exceeds initial uncertainty.
_DEFAULT_SIGMA: float = 25.0 / 3
_DEFAULT_MU: float = 25.0


def _parse_date(date_str: str) -> date | None:
    """Parse the first 10 chars of a date string as an ISO date."""
    try:
        return date.fromisoformat(date_str[:10])
    except (ValueError, IndexError):
        return None


class OpenSkillPLDecay(RatingAlgorithm):
    """PlackettLuce with per-(shooter, division) inactivity sigma decay."""

    def __init__(self) -> None:
        self.model = PlackettLuce()
        self._ratings: dict[DivKey, tuple[float, float]] = {}
        self._names: dict[int, str] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[DivKey, int] = defaultdict(int)
        self._seen_matches: set[str] = set()
        # ISO date string of last match per (shooter_id, division).
        self._last_date: dict[DivKey, str] = {}

    @property
    def name(self) -> str:
        return "openskill_pl_decay"

    def _get_rating(self, shooter_id: int, division: str | None) -> tuple[float, float]:
        key: DivKey = (shooter_id, division)
        if key not in self._ratings:
            r = self.model.rating()
            self._ratings[key] = (r.mu, r.sigma)
        return self._ratings[key]

    def _apply_decay(
        self, shooter_id: int, division: str | None, match_date_str: str
    ) -> None:
        """Increase sigma based on days since last match in this division."""
        key: DivKey = (shooter_id, division)
        last_str = self._last_date.get(key)
        if last_str is None:
            return  # First appearance in this division — no decay yet.

        match_d = _parse_date(match_date_str)
        last_d = _parse_date(last_str)
        if match_d is None or last_d is None:
            return

        days = (match_d - last_d).days
        if days <= 0:
            return

        mu, sigma = self._get_rating(shooter_id, division)
        self._ratings[key] = (mu, min(sigma + _TAU * days, _DEFAULT_SIGMA))

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

        # Collect (shooter, division) keys first so decay is applied before rating.
        pre_keys: set[DivKey] = set()
        for comp_id, _stage_id, _hf, _dq, dnf, _zeroed in stage_results:
            sid = competitor_shooter_map.get(comp_id)
            if sid is not None and not dnf:
                div = division_map.get(comp_id) if division_map else None
                pre_keys.add((sid, div))

        if match_date:
            for sid, div in pre_keys:
                self._apply_decay(sid, div, match_date)

        match_keys: set[DivKey] = set()

        by_stage: dict[int, list[tuple[int, float | None, bool, bool, bool]]] = defaultdict(list)
        for comp_id, stage_id, hf, dq, dnf, zeroed in stage_results:
            by_stage[stage_id].append((comp_id, hf, dq, dnf, zeroed))

        for _stage_id, stage_entries in by_stage.items():
            by_div, stage_keys = group_stage_by_division(
                stage_entries, competitor_shooter_map, division_map
            )
            match_keys.update(stage_keys)

            for div, div_ranked in by_div.items():
                if len(div_ranked) < 2:
                    continue
                div_ranked.sort(key=lambda x: x[1], reverse=True)

                teams = []
                ranks = []
                current_rank = 1
                for i, (sid, _) in enumerate(div_ranked):
                    mu, sigma = self._get_rating(sid, div)
                    r = self.model.rating(mu=mu, sigma=sigma)
                    teams.append([r])
                    if i > 0 and div_ranked[i][1] < div_ranked[i - 1][1]:
                        current_rank = i + 1
                    ranks.append(current_rank)

                updated = self.model.rate(teams, ranks=[float(r) for r in ranks])
                for i, (sid, _) in enumerate(div_ranked):
                    new_r = updated[i][0]
                    self._ratings[(sid, div)] = (new_r.mu, new_r.sigma)

        # Update metadata and last-seen date after rating update.
        for comp_id, shooter_id in competitor_shooter_map.items():
            if shooter_id is None:
                continue
            div = division_map.get(comp_id) if division_map else None
            key: DivKey = (shooter_id, div)
            if key in match_keys:
                self._matches[key] += 1
                if match_date:
                    self._last_date[key] = match_date
            if name_map and comp_id in name_map:
                self._names[shooter_id] = name_map[comp_id]
            if region_map and comp_id in region_map:
                self._regions[shooter_id] = region_map[comp_id]
            if category_map and comp_id in category_map:
                self._categories[shooter_id] = category_map[comp_id]

    def get_ratings(self) -> dict[DivKey, Rating]:
        result: dict[DivKey, Rating] = {}
        for (sid, div), (mu, sigma) in self._ratings.items():
            result[(sid, div)] = Rating(
                shooter_id=sid,
                name=self._names.get(sid, f"Shooter {sid}"),
                division=div,
                region=self._regions.get(sid),
                category=self._categories.get(sid),
                mu=mu,
                sigma=sigma,
                matches_played=self._matches.get((sid, div), 0),
            )
        return result

    def predict_rank(
        self, shooter_ids: list[int], division: str | None = None
    ) -> list[int]:
        rated = []
        for sid in shooter_ids:
            if division is not None:
                mu = self._ratings.get((sid, division), (_DEFAULT_MU, 0.0))[0]
            else:
                mus = [v[0] for k, v in self._ratings.items() if k[0] == sid]
                mu = max(mus) if mus else _DEFAULT_MU
            rated.append((sid, mu))
        rated.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in rated]

    def save_state(self, path: Path) -> None:
        state = {
            "ratings": {
                encode_div_key(s, d): list(v)
                for (s, d), v in self._ratings.items()
            },
            "matches": {
                encode_div_key(s, d): v
                for (s, d), v in self._matches.items()
            },
            "names": {str(k): v for k, v in self._names.items()},
            "regions": {str(k): v for k, v in self._regions.items()},
            "categories": {str(k): v for k, v in self._categories.items()},
            "seen_matches": list(self._seen_matches),
            "last_date": {
                encode_div_key(s, d): v for (s, d), v in self._last_date.items()
            },
        }
        path.write_text(json.dumps(state))

    def load_state(self, path: Path) -> None:
        state = json.loads(path.read_text())
        self._ratings = {
            decode_div_key(k): (v[0], v[1]) for k, v in state["ratings"].items()
        }
        self._matches = defaultdict(
            int, {decode_div_key(k): v for k, v in state["matches"].items()}
        )
        self._names = {int(k): v for k, v in state.get("names", {}).items()}
        self._regions = {int(k): v for k, v in state.get("regions", {}).items()}
        self._categories = {int(k): v for k, v in state.get("categories", {}).items()}
        self._seen_matches = set(state.get("seen_matches", []))
        self._last_date = {
            decode_div_key(k): v for k, v in state.get("last_date", {}).items()
        }
