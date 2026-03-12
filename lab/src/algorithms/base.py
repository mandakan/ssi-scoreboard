"""Abstract base class for rating algorithms."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import defaultdict
from pathlib import Path

from src.data.models import Rating

# ---------------------------------------------------------------------------
# Shared helpers used by all per-division algorithm implementations
# ---------------------------------------------------------------------------

DivKey = tuple[int, str | None]  # (shooter_id, division)


def encode_div_key(shooter_id: int, division: str | None) -> str:
    """Encode a (shooter_id, division) key for JSON serialisation.

    Format: ``"12345|Production"``; None division → ``"12345|"``.
    """
    return f"{shooter_id}|{division or ''}"


def decode_div_key(encoded: str) -> DivKey:
    """Decode a JSON-serialised (shooter_id, division) key."""
    sid_str, _, div_str = encoded.partition("|")
    return int(sid_str), (div_str if div_str else None)


def group_stage_by_division(
    stage_entries: list[tuple[int, float | None, bool, bool, bool]],
    competitor_shooter_map: dict[int, int | None],
    division_map: dict[int, str | None] | None,
) -> tuple[dict[str | None, list[tuple[int, float]]], set[DivKey]]:
    """Split a stage's results into per-division ranking groups.

    Args:
        stage_entries: [(competitor_id, hit_factor, dq, dnf, zeroed)]
        competitor_shooter_map: competitor_id → canonical shooter_id
        division_map: competitor_id → division string (None if not provided)

    Returns:
        by_div:    division → [(shooter_id, effective_hf)], DNF excluded
        match_keys: set of (shooter_id, division) pairs that participated
    """
    by_div: dict[str | None, list[tuple[int, float]]] = defaultdict(list)
    match_keys: set[DivKey] = set()

    for comp_id, hf, dq, dnf, zeroed in stage_entries:
        shooter_id = competitor_shooter_map.get(comp_id)
        if shooter_id is None or dnf:
            continue
        div = division_map.get(comp_id) if division_map else None
        effective_hf = 0.0 if (dq or zeroed) else (hf if hf is not None else 0.0)
        by_div[div].append((shooter_id, effective_hf))
        match_keys.add((shooter_id, div))

    return by_div, match_keys


def compute_division_weights(
    pct_by_division: dict[str | None, list[float]],
    percentile: float = 67.0,
) -> dict[str | None, float]:
    """Compute division weight factors as the Nth percentile of avg_overall_percent.

    Used for ``match_pct_combined`` scoring to normalise per-division performance
    onto a single cross-division scale. The weight for a division is the Nth
    percentile of competitors' average overall_percent values observed at the
    anchor events. A higher weight means the division historically scores higher
    percentages, so normalising by this weight equalises divisions.

    Args:
        pct_by_division: division → list of avg_overall_percent values from anchor matches.
        percentile: The percentile to use as the weight (0–100). Default 67.

    Returns:
        division → weight. Falls back to 100.0 for divisions with no anchor data.

    Example (ICS 2.0 style):
        weights = compute_division_weights(pct_by_div, percentile=67)
        normalized = competitor_avg_pct / weights.get(division, 100.0) * 100.0
    """
    weights: dict[str | None, float] = {}
    for div, pcts in pct_by_division.items():
        if not pcts:
            continue
        sorted_pcts = sorted(pcts)
        n = len(sorted_pcts)
        idx = (percentile / 100.0) * (n - 1)
        lo = int(idx)
        hi = min(lo + 1, n - 1)
        frac = idx - lo
        weights[div] = sorted_pcts[lo] + frac * (sorted_pcts[hi] - sorted_pcts[lo])
    return weights


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------

class RatingAlgorithm(ABC):
    """Base class for all rating algorithms.

    Algorithms process matches chronologically. Each stage within a match is
    treated as an independent N-player ranking event **within each division**.
    Competitors in different divisions are rated independently — a Production
    shooter and an Open shooter on the same stage do not directly influence
    each other's rating.

    The identity key is (shooter_id, division). A shooter competing in
    multiple divisions accumulates separate ratings for each.

    Future cross-division algorithms may override ``per_division`` to return
    False and use ``(shooter_id, None)`` keys in ``get_ratings()``.
    """

    @property
    def per_division(self) -> bool:
        """True if this algorithm maintains separate ratings per division."""
        return True

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
        *,
        name_map: dict[int, str] | None = None,
        division_map: dict[int, str | None] | None = None,
        region_map: dict[int, str | None] | None = None,
        category_map: dict[int, str | None] | None = None,
        match_level: str | None = None,
    ) -> None:
        """Process a single match's stage results.

        Args:
            ct: Content type
            match_id: Match identifier
            match_date: ISO date string or None
            stage_results: List of (competitor_id, stage_id, hit_factor, dq, dnf, zeroed)
            competitor_shooter_map: competitor_id → shooter_id mapping
            name_map: competitor_id → name mapping (optional)
            division_map: competitor_id → division mapping (optional)
            region_map: competitor_id → region mapping (optional)
            category_map: competitor_id → category mapping (optional)
            match_level: Match level string e.g. 'l2', 'l3', 'l4', 'l5' (optional)
        """

    @abstractmethod
    def get_ratings(self) -> dict[DivKey, Rating]:
        """Return current ratings keyed by (shooter_id, division).

        For cross-division algorithms (per_division=False), division is None.
        """

    @abstractmethod
    def predict_rank(
        self, shooter_ids: list[int], division: str | None = None
    ) -> list[int]:
        """Predict finishing order for a set of shooters (best first).

        When division is given, uses that division's rating for each shooter.
        When None, collapses across all divisions (uses max mu per shooter).
        """

    @abstractmethod
    def save_state(self, path: Path) -> None:
        """Serialize algorithm state to a file."""

    @abstractmethod
    def load_state(self, path: Path) -> None:
        """Deserialize algorithm state from a file."""


def get_algorithms(name: str | None = None) -> list[RatingAlgorithm]:
    """Get algorithm instances by name.

    None or 'default' → recommended algorithms only (bt_lvl, pl_decay, bt_lvl_decay).
    'all' → all algorithms including baselines (elo, openskill, openskill_bt, ics).
    Comma-separated list → the named algorithms in the given order, e.g.
        'openskill_pl_decay,openskill_bt_lvl_decay,ics'
    Any other single string → the single algorithm with that name.
    """
    from src.algorithms.elo import MultiElo
    from src.algorithms.ics import ICSAlgorithm
    from src.algorithms.openskill_bt import OpenSkillBT
    from src.algorithms.openskill_bt_lvl import OpenSkillBTLvl
    from src.algorithms.openskill_bt_lvl_decay import OpenSkillBTLvlDecay
    from src.algorithms.openskill_pl import OpenSkillPL
    from src.algorithms.openskill_pl_decay import OpenSkillPLDecay

    # Recommended algorithms — trained and exported by default.
    default_algos: list[RatingAlgorithm] = [
        OpenSkillPLDecay(),
        OpenSkillBTLvlDecay(),
        OpenSkillBTLvl(),
    ]

    # Baseline/experimental algorithms — available via --algorithm all or by name.
    extra_algos: list[RatingAlgorithm] = [
        OpenSkillPL(),
        OpenSkillBT(),
        MultiElo(),
        ICSAlgorithm(),
    ]

    all_algos = default_algos + extra_algos

    if name is None or name == "default":
        return default_algos

    if name == "all":
        return all_algos

    if "," in name:
        names = [n.strip() for n in name.split(",") if n.strip()]
        algo_map = {a.name: a for a in all_algos}
        result: list[RatingAlgorithm] = []
        for n in names:
            if n not in algo_map:
                available = ", ".join(algo_map)
                raise ValueError(f"Unknown algorithm '{n}'. Available: {available}")
            result.append(algo_map[n])
        return result

    for algo in all_algos:
        if algo.name == name:
            return [algo]

    available = ", ".join(a.name for a in all_algos)
    raise ValueError(f"Unknown algorithm '{name}'. Available: {available}")
