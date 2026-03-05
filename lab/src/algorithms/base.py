"""Abstract base class for rating algorithms."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from src.data.models import Rating


class RatingAlgorithm(ABC):
    """Base class for all rating algorithms.

    Algorithms process matches chronologically. Each stage within a match
    is treated as an independent N-player ranking event. The identity key
    is shooter_id (globally stable across matches).
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique algorithm identifier."""

    @abstractmethod
    def process_match_data(
        self,
        ct: int,
        match_id: str,
        match_date: str | None,
        stage_results: list[tuple[int, int, float | None, bool, bool, bool]],
        competitor_shooter_map: dict[int, int | None],
    ) -> None:
        """Process a single match's stage results.

        Args:
            ct: Content type
            match_id: Match identifier
            match_date: ISO date string or None
            stage_results: List of (competitor_id, stage_id, hit_factor, dq, dnf, zeroed)
            competitor_shooter_map: competitor_id → shooter_id mapping
        """

    @abstractmethod
    def get_ratings(self) -> dict[int, Rating]:
        """Return current ratings keyed by shooter_id."""

    @abstractmethod
    def predict_rank(self, shooter_ids: list[int]) -> list[int]:
        """Predict finishing order for a set of shooters (best first)."""

    @abstractmethod
    def save_state(self, path: Path) -> None:
        """Serialize algorithm state to a file."""

    @abstractmethod
    def load_state(self, path: Path) -> None:
        """Deserialize algorithm state from a file."""


def get_algorithms(name: str | None = None) -> list[RatingAlgorithm]:
    """Get algorithm instances by name. None or 'all' returns all."""
    from src.algorithms.elo import MultiElo
    from src.algorithms.openskill_pl import OpenSkillPL

    all_algos: list[RatingAlgorithm] = [OpenSkillPL(), MultiElo()]

    if name is None or name == "all":
        return all_algos

    for algo in all_algos:
        if algo.name == name:
            return [algo]

    available = ", ".join(a.name for a in all_algos)
    raise ValueError(f"Unknown algorithm '{name}'. Available: {available}")
