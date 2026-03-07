"""OpenSkill BradleyTerryPart with match-level beta scaling and inactivity decay.

Combines both innovations from the other variants:
- BradleyTerryPart model with per-level beta scaling (openskill_bt_lvl)
- Inactivity sigma decay proportional to days since last match (openskill_pl_decay)

Concept and beta values adapted from Jonas Emilsson's ipsc-ranking project
(https://github.com/ipsc-ranking/ipsc-ranking.github.io, CC BY-NC-SA 4.0).
Only the algorithmic ideas are borrowed; the implementation follows this
project's conventions and architecture.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from openskill.models import BradleyTerryPart

from src.algorithms.base import (
    DivKey,
    RatingAlgorithm,
    decode_div_key,
    encode_div_key,
    group_stage_by_division,
)
from src.data.models import Rating

_DEFAULT_MU = 25.0
_LEVEL_BETA: dict[str, float] = {
    "l2": _DEFAULT_MU / 12,
    "l3": _DEFAULT_MU / 6,
    "l4": _DEFAULT_MU / 3,
    "l5": _DEFAULT_MU / 1.5,
}
_TAU: float = _DEFAULT_MU / 300
_DEFAULT_SIGMA: float = _DEFAULT_MU / 3


def _parse_date(date_str: str) -> date | None:
    try:
        return date.fromisoformat(date_str[:10])
    except (ValueError, IndexError):
        return None


class OpenSkillBTLvlDecay(RatingAlgorithm):
    """BradleyTerryPart with level-scaled beta and per-(shooter, division) sigma decay."""

    def __init__(self) -> None:
        self._model = BradleyTerryPart()
        self._level_models = {
            lvl: BradleyTerryPart(beta=beta) for lvl, beta in _LEVEL_BETA.items()
        }

        self._ratings: dict[DivKey, tuple[float, float]] = {}
        self._names: dict[int, str] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[DivKey, int] = defaultdict(int)
        self._seen_matches: set[str] = set()
        self._last_date: dict[DivKey, str] = {}

    @property
    def name(self) -> str:
        return "openskill_bt_lvl_decay"

    def _get_rating(self, shooter_id: int, division: str | None) -> tuple[float, float]:
        key: DivKey = (shooter_id, division)
        if key not in self._ratings:
            r = self._model.rating()
            self._ratings[key] = (r.mu, r.sigma)
        return self._ratings[key]

    def _apply_decay(
        self, shooter_id: int, division: str | None, match_date_str: str
    ) -> None:
        key: DivKey = (shooter_id, division)
        last_str = self._last_date.get(key)
        if last_str is None:
            return

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

        rate_model = self._level_models.get(match_level or "", self._model)

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
                    r = self._model.rating(mu=mu, sigma=sigma)
                    teams.append([r])
                    if i > 0 and div_ranked[i][1] < div_ranked[i - 1][1]:
                        current_rank = i + 1
                    ranks.append(current_rank)

                updated = rate_model.rate(teams, ranks=[float(r) for r in ranks])
                for i, (sid, _) in enumerate(div_ranked):
                    new_r = updated[i][0]
                    self._ratings[(sid, div)] = (new_r.mu, new_r.sigma)

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
