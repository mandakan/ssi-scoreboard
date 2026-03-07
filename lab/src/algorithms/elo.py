"""Multi-player ELO baseline algorithm.

Simple ELO-style rating where each stage is a series of pairwise comparisons
**within each division**. K-factor decreases with more matches played. Used as
a baseline for benchmarking against the OpenSkill algorithms.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

from src.algorithms.base import (
    DivKey,
    RatingAlgorithm,
    decode_div_key,
    encode_div_key,
    group_stage_by_division,
)
from src.data.models import Rating

DEFAULT_RATING = 1500.0
DEFAULT_K = 32.0
MIN_K = 16.0
K_DECAY_MATCHES = 20  # K decays from DEFAULT_K to MIN_K over this many matches


class MultiElo(RatingAlgorithm):
    """Multi-player ELO with pairwise stage comparisons, per-division ratings."""

    def __init__(self) -> None:
        self._ratings: dict[DivKey, float] = {}
        self._names: dict[int, str] = {}
        self._regions: dict[int, str | None] = {}
        self._categories: dict[int, str | None] = {}
        self._matches: dict[DivKey, int] = defaultdict(int)
        self._seen_matches: set[str] = set()

    @property
    def name(self) -> str:
        return "elo"

    def _k_factor(self, key: DivKey) -> float:
        """Adaptive K-factor that decreases with experience."""
        matches = self._matches.get(key, 0)
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
        match_level: str | None = None,
    ) -> None:
        match_key = f"{ct}:{match_id}"
        if match_key in self._seen_matches:
            return
        self._seen_matches.add(match_key)

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

                n = len(div_ranked)
                deltas: dict[DivKey, float] = defaultdict(float)

                for i in range(n):
                    sid_a, hf_a = div_ranked[i]
                    key_a: DivKey = (sid_a, div)
                    ra = self._ratings.get(key_a, DEFAULT_RATING)
                    k_a = self._k_factor(key_a)

                    for j in range(i + 1, n):
                        sid_b, hf_b = div_ranked[j]
                        key_b: DivKey = (sid_b, div)
                        rb = self._ratings.get(key_b, DEFAULT_RATING)
                        k_b = self._k_factor(key_b)

                        expected_a = self._expected_score(ra, rb)

                        if hf_a > hf_b:
                            actual_a = 1.0
                        elif hf_a == hf_b:
                            actual_a = 0.5
                        else:
                            actual_a = 0.0

                        # Scale by 1/n to avoid over-updating with many competitors
                        scale = 1.0 / n
                        deltas[key_a] += k_a * (actual_a - expected_a) * scale
                        deltas[key_b] += k_b * ((1.0 - actual_a) - (1.0 - expected_a)) * scale

                for key, delta in deltas.items():
                    current = self._ratings.get(key, DEFAULT_RATING)
                    self._ratings[key] = current + delta

        for comp_id, shooter_id in competitor_shooter_map.items():
            if shooter_id is None:
                continue
            div = division_map.get(comp_id) if division_map else None
            comp_key: DivKey = (shooter_id, div)
            if comp_key in match_keys:
                self._matches[comp_key] += 1
            if name_map and comp_id in name_map:
                self._names[shooter_id] = name_map[comp_id]
            if region_map and comp_id in region_map:
                self._regions[shooter_id] = region_map[comp_id]
            if category_map and comp_id in category_map:
                self._categories[shooter_id] = category_map[comp_id]

    def get_ratings(self) -> dict[DivKey, Rating]:
        result: dict[DivKey, Rating] = {}
        for (sid, div), rating in self._ratings.items():
            result[(sid, div)] = Rating(
                shooter_id=sid,
                name=self._names.get(sid, f"Shooter {sid}"),
                division=div,
                region=self._regions.get(sid),
                category=self._categories.get(sid),
                mu=rating,
                sigma=0.0,  # ELO doesn't have a separate sigma
                matches_played=self._matches.get((sid, div), 0),
            )
        return result

    def predict_rank(
        self, shooter_ids: list[int], division: str | None = None
    ) -> list[int]:
        rated = []
        for sid in shooter_ids:
            if division is not None:
                rating = self._ratings.get((sid, division), DEFAULT_RATING)
            else:
                ratings = [v for (s, _), v in self._ratings.items() if s == sid]
                rating = max(ratings) if ratings else DEFAULT_RATING
            rated.append((sid, rating))
        rated.sort(key=lambda x: x[1], reverse=True)
        return [sid for sid, _ in rated]

    def save_state(self, path: Path) -> None:
        state = {
            "ratings": {
                encode_div_key(s, d): v for (s, d), v in self._ratings.items()
            },
            "matches": {
                encode_div_key(s, d): v for (s, d), v in self._matches.items()
            },
            "names": {str(k): v for k, v in self._names.items()},
            "regions": {str(k): v for k, v in self._regions.items()},
            "categories": {str(k): v for k, v in self._categories.items()},
            "seen_matches": list(self._seen_matches),
        }
        path.write_text(json.dumps(state))

    def load_state(self, path: Path) -> None:
        state = json.loads(path.read_text())
        self._ratings = {decode_div_key(k): v for k, v in state["ratings"].items()}
        self._matches = defaultdict(
            int, {decode_div_key(k): v for k, v in state["matches"].items()}
        )
        self._names = {int(k): v for k, v in state.get("names", {}).items()}
        self._regions = {int(k): v for k, v in state.get("regions", {}).items()}
        self._categories = {int(k): v for k, v in state.get("categories", {}).items()}
        self._seen_matches = set(state.get("seen_matches", []))
