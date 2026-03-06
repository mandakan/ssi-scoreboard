"""OpenSkill BradleyTerryPart with match-level beta scaling.

Same as openskill_bt, but the beta parameter (performance variability) is
scaled by match level. Higher-level matches use a larger beta, which increases
how much a result can shift ratings — rewarding/penalising unexpected outcomes
more at elite events than at regional ones.

Concept and beta values adapted from Jonas Emilsson's ipsc-ranking project
(https://github.com/ipsc-ranking/ipsc-ranking.github.io, CC BY-NC-SA 4.0).
Only the algorithmic idea is borrowed; the implementation follows this project's
conventions and architecture.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from openskill.models import BradleyTerryPart

from src.algorithms.base import RatingAlgorithm
from src.data.models import Rating

# OpenSkill default mu = 25.0.
# Beta values scale by match level; l3 ≈ default beta (sigma/2 ≈ 4.17).
_DEFAULT_MU = 25.0
_LEVEL_BETA: dict[str, float] = {
    "l2": _DEFAULT_MU / 12,   # ≈ 2.08 — regional
    "l3": _DEFAULT_MU / 6,    # ≈ 4.17 — national (near default)
    "l4": _DEFAULT_MU / 3,    # ≈ 8.33 — continental
    "l5": _DEFAULT_MU / 1.5,  # ≈ 16.67 — world
}


class OpenSkillBTLvl(RatingAlgorithm):
    """BradleyTerryPart with match-level beta scaling."""

    def __init__(self) -> None:
        # Main model: creates ratings and is used when level is unknown.
        self._model = BradleyTerryPart()
        # Per-level models: used only for the rate() call.
        self._level_models = {lvl: BradleyTerryPart(beta=beta) for lvl, beta in _LEVEL_BETA.items()}

        self._ratings: dict[int, tuple[float, float]] = {}
        self._names: dict[int, str] = {}
        self._divisions: dict[int, str | None] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[int, int] = defaultdict(int)
        self._seen_matches: set[str] = set()

    @property
    def name(self) -> str:
        return "openskill_bt_lvl"

    def _get_rating(self, shooter_id: int) -> tuple[float, float]:
        if shooter_id not in self._ratings:
            r = self._model.rating()
            self._ratings[shooter_id] = (r.mu, r.sigma)
        return self._ratings[shooter_id]

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

        # Select rating model based on match level; fall back to default.
        rate_model = self._level_models.get(match_level or "", self._model)

        match_shooters: set[int] = set()

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
                match_shooters.add(shooter_id)

            if len(ranked) < 2:
                continue

            ranked.sort(key=lambda x: x[1], reverse=True)

            teams = []
            ranks = []
            current_rank = 1
            for i, (sid, _) in enumerate(ranked):
                mu, sigma = self._get_rating(sid)
                # Use main model to construct Rating objects (mu/sigma defaults).
                r = self._model.rating(mu=mu, sigma=sigma)
                teams.append([r])
                if i > 0 and ranked[i][1] < ranked[i - 1][1]:
                    current_rank = i + 1
                ranks.append(current_rank)

            # rate() uses rate_model's beta to determine update magnitude.
            updated = rate_model.rate(teams, ranks=[float(r) for r in ranks])

            for i, (sid, _) in enumerate(ranked):
                new_r = updated[i][0]
                self._ratings[sid] = (new_r.mu, new_r.sigma)

        for comp_id, shooter_id in competitor_shooter_map.items():
            if shooter_id is None:
                continue
            if shooter_id in match_shooters:
                self._matches[shooter_id] += 1
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
