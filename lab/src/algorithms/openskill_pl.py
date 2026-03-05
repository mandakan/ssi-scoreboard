"""OpenSkill Plackett-Luce rating algorithm.

Each stage is an independent N-player ranking event. Competitors are ranked
by hit factor. DQ/zeroed → HF 0 (ranked last). DNF → excluded.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from openskill.models import PlackettLuce

from src.algorithms.base import RatingAlgorithm
from src.data.models import Rating


class OpenSkillPL(RatingAlgorithm):
    """OpenSkill Plackett-Luce (Weng-Lin Bayesian) rating algorithm."""

    def __init__(self) -> None:
        self.model = PlackettLuce()
        # shooter_id → (mu, sigma)
        self._ratings: dict[int, tuple[float, float]] = {}
        # shooter_id → name (most recent)
        self._names: dict[int, str] = {}
        # shooter_id → division (most recent)
        self._divisions: dict[int, str | None] = {}
        # shooter_id → region (most recent)
        self._regions: dict[int, str | None] = {}
        # shooter_id → category (most recent)
        self._categories: dict[int, str | None] = {}
        # shooter_id → matches_played count
        self._matches: dict[int, int] = defaultdict(int)
        # Track which shooters participated in each match (by match key)
        self._seen_matches: set[str] = set()

    @property
    def name(self) -> str:
        return "openskill"

    def _get_rating(self, shooter_id: int) -> tuple[float, float]:
        """Get or create a rating for a shooter."""
        if shooter_id not in self._ratings:
            r = self.model.rating()
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
    ) -> None:
        match_key = f"{ct}:{match_id}"
        if match_key in self._seen_matches:
            return
        self._seen_matches.add(match_key)

        # Track which shooters are in this match
        match_shooters: set[int] = set()

        # Group results by stage
        by_stage: dict[int, list[tuple[int, float | None, bool, bool, bool]]] = defaultdict(list)
        for comp_id, stage_id, hf, dq, dnf, zeroed in stage_results:
            by_stage[stage_id].append((comp_id, hf, dq, dnf, zeroed))

        for _stage_id, stage_entries in by_stage.items():
            # Build ranking: exclude DNF, treat DQ/zeroed as HF=0
            ranked: list[tuple[int, float]] = []
            for comp_id, hf, dq, dnf, zeroed in stage_entries:
                shooter_id = competitor_shooter_map.get(comp_id)
                if shooter_id is None:
                    continue
                if dnf:
                    continue
                effective_hf = 0.0 if (dq or zeroed) else (hf if hf is not None else 0.0)
                ranked.append((shooter_id, effective_hf))
                match_shooters.add(shooter_id)

            if len(ranked) < 2:
                continue

            # Sort by hit factor descending
            ranked.sort(key=lambda x: x[1], reverse=True)

            # Build teams (each team = 1 player) and ranks
            teams = []
            ranks = []
            current_rank = 1
            for i, (sid, _ehf) in enumerate(ranked):
                mu, sigma = self._get_rating(sid)
                r = self.model.rating(mu=mu, sigma=sigma)
                teams.append([r])
                if i > 0 and ranked[i][1] < ranked[i - 1][1]:
                    current_rank = i + 1
                ranks.append(current_rank)

            # Rate — OpenSkill expects list[float] for ranks
            updated = self.model.rate(teams, ranks=[float(r) for r in ranks])

            # Store updated ratings
            for i, (sid, _) in enumerate(ranked):
                new_r = updated[i][0]
                self._ratings[sid] = (new_r.mu, new_r.sigma)

        # Update match counts and metadata
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
        rated = []
        for sid in shooter_ids:
            mu, sigma = self._get_rating(sid)
            rated.append((sid, mu))
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
