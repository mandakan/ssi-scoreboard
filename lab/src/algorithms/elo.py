"""Multi-player ELO baseline algorithm.

Simple ELO-style rating where each stage is a series of pairwise comparisons.
K-factor decreases with more matches played. Used as a baseline for
benchmarking against the OpenSkill Plackett-Luce algorithm.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from src.algorithms.base import RatingAlgorithm
from src.data.models import Rating

DEFAULT_RATING = 1500.0
DEFAULT_K = 32.0
MIN_K = 16.0
K_DECAY_MATCHES = 20  # K decays from DEFAULT_K to MIN_K over this many matches


class MultiElo(RatingAlgorithm):
    """Multi-player ELO with pairwise stage comparisons."""

    def __init__(self) -> None:
        self._ratings: dict[int, float] = {}
        self._names: dict[int, str] = {}
        self._divisions: dict[int, str | None] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[int, int] = defaultdict(int)
        self._seen_matches: set[str] = set()

    @property
    def name(self) -> str:
        return "elo"

    def _k_factor(self, shooter_id: int) -> float:
        """Adaptive K-factor that decreases with experience."""
        matches = self._matches.get(shooter_id, 0)
        if matches >= K_DECAY_MATCHES:
            return MIN_K
        t = matches / K_DECAY_MATCHES
        return DEFAULT_K - (DEFAULT_K - MIN_K) * t

    def _expected_score(self, ra: float, rb: float) -> float:
        """Expected score of player A vs player B."""
        return 1.0 / (1.0 + math.pow(10.0, (rb - ra) / 400.0))

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

        match_shooters: set[int] = set()

        # Group results by stage
        by_stage: dict[int, list[tuple[int, float]]] = defaultdict(list)
        for comp_id, stage_id, hf, dq, dnf, zeroed in stage_results:
            shooter_id = competitor_shooter_map.get(comp_id)
            if shooter_id is None or dnf:
                continue
            effective_hf = 0.0 if (dq or zeroed) else (hf if hf is not None else 0.0)
            by_stage[stage_id].append((shooter_id, effective_hf))
            match_shooters.add(shooter_id)

        for _stage_id, stage_entries in by_stage.items():
            if len(stage_entries) < 2:
                continue

            # Sort by hit factor descending for ranking
            stage_entries.sort(key=lambda x: x[1], reverse=True)

            # Compute pairwise ELO updates
            deltas: dict[int, float] = defaultdict(float)
            n = len(stage_entries)

            for i in range(n):
                sid_a = stage_entries[i][0]
                hf_a = stage_entries[i][1]
                ra = self._ratings.get(sid_a, DEFAULT_RATING)
                k_a = self._k_factor(sid_a)

                for j in range(i + 1, n):
                    sid_b = stage_entries[j][0]
                    hf_b = stage_entries[j][1]
                    rb = self._ratings.get(sid_b, DEFAULT_RATING)
                    k_b = self._k_factor(sid_b)

                    expected_a = self._expected_score(ra, rb)

                    # Actual score: 1 if A won, 0.5 if tied, 0 if B won
                    if hf_a > hf_b:
                        actual_a = 1.0
                    elif hf_a == hf_b:
                        actual_a = 0.5
                    else:
                        actual_a = 0.0

                    # Scale by 1/n to avoid over-updating with many competitors
                    scale = 1.0 / n
                    deltas[sid_a] += k_a * (actual_a - expected_a) * scale
                    deltas[sid_b] += k_b * ((1.0 - actual_a) - (1.0 - expected_a)) * scale

            # Apply deltas
            for sid, delta in deltas.items():
                current = self._ratings.get(sid, DEFAULT_RATING)
                self._ratings[sid] = current + delta

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
        for sid, rating in self._ratings.items():
            result[sid] = Rating(
                shooter_id=sid,
                name=self._names.get(sid, f"Shooter {sid}"),
                division=self._divisions.get(sid),
                region=self._regions.get(sid),
                category=self._categories.get(sid),
                mu=rating,
                sigma=0.0,  # ELO doesn't have a separate sigma
                matches_played=self._matches.get(sid, 0),
            )
        return result

    def predict_rank(self, shooter_ids: list[int]) -> list[int]:
        rated = [(sid, self._ratings.get(sid, DEFAULT_RATING)) for sid in shooter_ids]
        rated.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in rated]

    def save_state(self, path: Path) -> None:
        state = {
            "ratings": {str(k): v for k, v in self._ratings.items()},
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
        self._ratings = {int(k): v for k, v in state["ratings"].items()}
        self._matches = defaultdict(int, {int(k): v for k, v in state["matches"].items()})
        self._names = {int(k): v for k, v in state.get("names", {}).items()}
        self._divisions = {int(k): v for k, v in state.get("divisions", {}).items()}
        self._regions = {int(k): v for k, v in state.get("regions", {}).items()}
        self._categories = {int(k): v for k, v in state.get("categories", {}).items()}
        self._seen_matches = set(state.get("seen_matches", []))
