"""Tests for rating algorithms."""

from pathlib import Path

import pytest

from src.algorithms.elo import MultiElo
from src.algorithms.openskill_pl import OpenSkillPL

# Shared test data: 2 competitors, 2 stages
# Competitor 1 (shooter 100) wins both stages
# Competitor 2 (shooter 200) loses both stages
STAGE_RESULTS: list[tuple[int, int, float | None, bool, bool, bool]] = [
    # (competitor_id, stage_id, hit_factor, dq, dnf, zeroed)
    (1, 10, 5.0, False, False, False),
    (2, 10, 3.0, False, False, False),
    (1, 20, 6.0, False, False, False),
    (2, 20, 4.0, False, False, False),
]

COMP_MAP: dict[int, int | None] = {1: 100, 2: 200}


class TestOpenSkillPL:
    def test_name(self) -> None:
        assert OpenSkillPL().name == "openskill"

    def test_process_match(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert 100 in ratings
        assert 200 in ratings
        assert ratings[100].mu > ratings[200].mu

    def test_predict_rank(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        predicted = algo.predict_rank([100, 200])
        assert predicted == [100, 200]

    def test_idempotent(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[100].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r2 = algo.get_ratings()[100].mu
        assert r1 == r2

    def test_dnf_excluded(self) -> None:
        results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 10, 5.0, False, False, False),
            (2, 10, 0.0, False, True, False),  # DNF
        ]
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", None, results, COMP_MAP)
        ratings = algo.get_ratings()
        # Shooter 200 should still not have a rating (DNF on the only stage)
        assert 200 not in ratings

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)

        algo2 = OpenSkillPL()
        algo2.load_state(path)
        assert algo.get_ratings()[100].mu == algo2.get_ratings()[100].mu


class TestMultiElo:
    def test_name(self) -> None:
        assert MultiElo().name == "elo"

    def test_process_match(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert 100 in ratings
        assert 200 in ratings
        assert ratings[100].mu > ratings[200].mu

    def test_predict_rank(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        predicted = algo.predict_rank([100, 200])
        assert predicted == [100, 200]

    def test_idempotent(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[100].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r2 = algo.get_ratings()[100].mu
        assert r1 == r2

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)

        algo2 = MultiElo()
        algo2.load_state(path)
        assert algo.get_ratings()[100].mu == pytest.approx(algo2.get_ratings()[100].mu)
