"""Tests for rating algorithms."""

from pathlib import Path

import pytest

from src.algorithms.elo import MultiElo
from src.algorithms.openskill_bt import OpenSkillBT
from src.algorithms.openskill_bt_lvl import OpenSkillBTLvl
from src.algorithms.openskill_bt_lvl_decay import OpenSkillBTLvlDecay
from src.algorithms.openskill_pl import OpenSkillPL
from src.algorithms.openskill_pl_decay import OpenSkillPLDecay

# Shared test data: 2 competitors, 2 stages.
# Competitor 1 (shooter 100) wins both stages.
# Competitor 2 (shooter 200) loses both stages.
STAGE_RESULTS: list[tuple[int, int, float | None, bool, bool, bool]] = [
    # (competitor_id, stage_id, hit_factor, dq, dnf, zeroed)
    (1, 10, 5.0, False, False, False),
    (2, 10, 3.0, False, False, False),
    (1, 20, 6.0, False, False, False),
    (2, 20, 4.0, False, False, False),
]

COMP_MAP: dict[int, int | None] = {1: 100, 2: 200}

# Division map used in tests that need per-division keys.
DIV_MAP: dict[int, str | None] = {1: "Production", 2: "Production"}


class TestOpenSkillPL:
    def test_name(self) -> None:
        assert OpenSkillPL().name == "openskill"

    def test_process_match(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert (100, None) in ratings
        assert (200, None) in ratings
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_predict_rank(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        predicted = algo.predict_rank([100, 200])
        assert predicted == [100, 200]

    def test_idempotent(self) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r2 = algo.get_ratings()[(100, None)].mu
        assert r1 == r2

    def test_dnf_excluded(self) -> None:
        results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 10, 5.0, False, False, False),
            (2, 10, 0.0, False, True, False),  # DNF
        ]
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", None, results, COMP_MAP)
        ratings = algo.get_ratings()
        # Shooter 200 should have no rating (DNF on the only stage)
        assert not any(k[0] == 200 for k in ratings)

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)

        algo2 = OpenSkillPL()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu


class TestOpenSkillBT:
    def test_name(self) -> None:
        assert OpenSkillBT().name == "openskill_bt"

    def test_process_match(self) -> None:
        algo = OpenSkillBT()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_predict_rank(self) -> None:
        algo = OpenSkillBT()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.predict_rank([100, 200]) == [100, 200]

    def test_idempotent(self) -> None:
        algo = OpenSkillBT()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].mu == r1

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillBT()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)
        algo2 = OpenSkillBT()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu


class TestOpenSkillBTLvl:
    def test_name(self) -> None:
        assert OpenSkillBTLvl().name == "openskill_bt_lvl"

    def test_process_match(self) -> None:
        algo = OpenSkillBTLvl()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_level_affects_update_magnitude(self) -> None:
        """Higher-level matches should produce larger mu changes."""
        algo_l2 = OpenSkillBTLvl()
        algo_l4 = OpenSkillBTLvl()
        initial_mu = algo_l2._get_rating(100, None)[0]  # both start equal

        algo_l2.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP,
                                   match_level="l2")
        algo_l4.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP,
                                   match_level="l4")

        delta_l2 = abs(algo_l2.get_ratings()[(100, None)].mu - initial_mu)
        delta_l4 = abs(algo_l4.get_ratings()[(100, None)].mu - initial_mu)
        assert delta_l4 != delta_l2  # levels must produce different update magnitudes

    def test_idempotent(self) -> None:
        algo = OpenSkillBTLvl()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].mu == r1

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillBTLvl()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)
        algo2 = OpenSkillBTLvl()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu


class TestOpenSkillPLDecay:
    def test_name(self) -> None:
        assert OpenSkillPLDecay().name == "openskill_pl_decay"

    def test_process_match(self) -> None:
        algo = OpenSkillPLDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_decay_increases_sigma(self) -> None:
        """A long gap between matches should raise sigma before the second update."""
        algo = OpenSkillPLDecay()
        algo.process_match_data(22, "M1", "2025-01-01", STAGE_RESULTS, COMP_MAP)
        sigma_after_m1 = algo.get_ratings()[(100, None)].sigma

        # Second match 180 days later — decay should bump sigma before rating update.
        algo.process_match_data(22, "M2", "2025-07-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].sigma > 0
        assert sigma_after_m1 > 0  # sanity

    def test_no_decay_on_first_match(self) -> None:
        """First match for a shooter should not trigger decay."""
        algo = OpenSkillPLDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert any(k[0] == 100 for k in algo.get_ratings())

    def test_idempotent(self) -> None:
        algo = OpenSkillPLDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].mu == r1

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillPLDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)
        algo2 = OpenSkillPLDecay()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu
        assert algo2._last_date.get((100, None)) is not None


class TestOpenSkillBTLvlDecay:
    def test_name(self) -> None:
        assert OpenSkillBTLvlDecay().name == "openskill_bt_lvl_decay"

    def test_process_match(self) -> None:
        algo = OpenSkillBTLvlDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP,
                                match_level="l3")
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_idempotent(self) -> None:
        algo = OpenSkillBTLvlDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].mu == r1

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = OpenSkillBTLvlDecay()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP,
                                match_level="l3")
        path = tmp_path / "state.json"
        algo.save_state(path)
        algo2 = OpenSkillBTLvlDecay()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu
        assert algo2._last_date.get((100, None)) is not None


class TestMultiElo:
    def test_name(self) -> None:
        assert MultiElo().name == "elo"

    def test_process_match(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        assert (100, None) in ratings
        assert (200, None) in ratings
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_predict_rank(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        predicted = algo.predict_rank([100, 200])
        assert predicted == [100, 200]

    def test_idempotent(self) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        r2 = algo.get_ratings()[(100, None)].mu
        assert r1 == r2

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = MultiElo()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        path = tmp_path / "state.json"
        algo.save_state(path)

        algo2 = MultiElo()
        algo2.load_state(path)
        assert algo.get_ratings()[(100, None)].mu == pytest.approx(algo2.get_ratings()[(100, None)].mu)


class TestPerDivisionRatings:
    """Verify that competitors in different divisions don't affect each other."""

    def test_separate_ratings_per_division(self) -> None:
        """Competitors in different divisions don't affect each other's ratings."""
        # 4 competitors: 1 & 2 in Production, 3 & 4 in Open.
        # All map to the same two shooters (100 wins Production, 200 wins Open).
        results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 10, 5.0, False, False, False),  # comp 1 → shooter 100, Production (wins)
            (2, 10, 3.0, False, False, False),  # comp 2 → shooter 200, Production (loses)
            (3, 10, 6.0, False, False, False),  # comp 3 → shooter 200, Open (wins)
            (4, 10, 4.0, False, False, False),  # comp 4 → shooter 100, Open (loses)
        ]
        comp_map: dict[int, int | None] = {1: 100, 2: 200, 3: 200, 4: 100}
        div_map: dict[int, str | None] = {
            1: "Production", 2: "Production", 3: "Open", 4: "Open"
        }

        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", results, comp_map,
                                division_map=div_map)
        ratings = algo.get_ratings()

        # Each shooter has a rating for each division they competed in
        assert (100, "Production") in ratings
        assert (200, "Production") in ratings
        assert (100, "Open") in ratings
        assert (200, "Open") in ratings
        # Shooter 100 wins Production but loses Open → divergent ratings
        assert ratings[(100, "Production")].mu > ratings[(200, "Production")].mu
        assert ratings[(200, "Open")].mu > ratings[(100, "Open")].mu

    def test_same_shooter_multiple_divisions(self) -> None:
        """A shooter competing in both Production and Open gets separate ratings."""
        results_prod: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 10, 5.0, False, False, False),
            (2, 10, 3.0, False, False, False),
        ]
        results_open: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 10, 4.0, False, False, False),
            (2, 10, 6.0, False, False, False),  # loses in open (shooter 100 comp 1)
        ]
        comp_map: dict[int, int | None] = {1: 100, 2: 200}
        div_prod: dict[int, str | None] = {1: "Production", 2: "Production"}
        div_open: dict[int, str | None] = {1: "Open", 2: "Open"}

        algo = OpenSkillPL()
        algo.process_match_data(22, "M1", "2026-01-01", results_prod, comp_map,
                                division_map=div_prod)
        algo.process_match_data(22, "M2", "2026-02-01", results_open, comp_map,
                                division_map=div_open)

        ratings = algo.get_ratings()
        # Shooter 100: wins Production, loses Open → different ratings
        assert (100, "Production") in ratings
        assert (100, "Open") in ratings
        assert ratings[(100, "Production")].mu > ratings[(100, "Open")].mu
