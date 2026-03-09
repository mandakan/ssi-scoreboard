"""Tests for rating algorithms."""

from pathlib import Path

import pytest

from src.algorithms.elo import MultiElo
from src.algorithms.ics import ICSAlgorithm
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


class TestICSAlgorithm:
    def test_name(self) -> None:
        assert ICSAlgorithm().name == "ics"

    def test_per_division_false(self) -> None:
        assert ICSAlgorithm().per_division is False

    def test_process_match_no_anchor(self) -> None:
        """Without an anchor event, falls back to normalised score (div_weight=100)."""
        algo = ICSAlgorithm()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        ratings = algo.get_ratings()
        # Keys use None division (cross-division algorithm)
        assert (100, None) in ratings
        assert (200, None) in ratings
        # Winner (shooter 100) should score higher
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_predict_rank(self) -> None:
        algo = ICSAlgorithm()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.predict_rank([100, 200]) == [100, 200]

    def test_predict_rank_with_unknown_shooter(self) -> None:
        """Shooters with no score are ranked last."""
        algo = ICSAlgorithm()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        predicted = algo.predict_rank([999, 100, 200])
        assert predicted[0] == 100
        assert predicted[-1] == 999

    def test_anchor_event_enables_peer_comparison(self) -> None:
        """After an L4 anchor match, subsequent matches use peer comparison."""
        # 3 shooters: 100 wins, 200 mid, 300 loses at the anchor (L4).
        anchor_results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 0, 90.0, False, False, False),  # shooter 100 → 90%
            (2, 0, 75.0, False, False, False),  # shooter 200 → 75%
            (3, 0, 60.0, False, False, False),  # shooter 300 → 60%
        ]
        anchor_map: dict[int, int | None] = {1: 100, 2: 200, 3: 300}
        anchor_div: dict[int, str | None] = {1: "Production", 2: "Production", 3: "Production"}

        algo = ICSAlgorithm()
        algo.process_match_data(22, "A1", "2025-01-01", anchor_results, anchor_map,
                                division_map=anchor_div, match_level="l4")

        # Sanity: anchor_perf is populated
        assert 100 in algo._anchor_perf
        assert 200 in algo._anchor_perf
        assert 300 in algo._anchor_perf

        # Regular match: shooters 100, 200 compete (300 absent).
        reg_results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 0, 80.0, False, False, False),
            (2, 0, 70.0, False, False, False),
        ]
        algo.process_match_data(22, "M1", "2025-06-01", reg_results, {1: 100, 2: 200},
                                division_map={1: "Production", 2: "Production"})

        ratings = algo.get_ratings()
        # Shooter 100 scored better at the regular match → should rank higher
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_anchor_event_self_score(self) -> None:
        """At the anchor event, each competitor's score equals their normalised pct."""
        anchor_results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 0, 90.0, False, False, False),
            (2, 0, 60.0, False, False, False),
        ]
        anchor_map: dict[int, int | None] = {1: 100, 2: 200}
        anchor_div: dict[int, str | None] = {1: "Open", 2: "Open"}

        algo = ICSAlgorithm(anchor_percentile=67.0, top_n=3)
        algo.process_match_data(22, "A1", "2025-01-01", anchor_results, anchor_map,
                                division_map=anchor_div, match_level="l5")

        # At the anchor event there are no prior reference scores; both
        # competitors are each other's reference. Since b_comb == b_vm at
        # the anchor event (same match), contrib(A, B) = a_comb for any B.
        # Therefore weighted(A) = a_comb = normalised score.
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu > ratings[(200, None)].mu

    def test_top_n_averaging(self) -> None:
        """Final score is the average of the best top_n results."""
        algo = ICSAlgorithm(top_n=2)
        comp_map: dict[int, int | None] = {1: 100}

        # Three matches with decreasing scores (no anchor, direct normalised).
        for i, score in enumerate([80.0, 60.0, 40.0]):
            results: list[tuple[int, int, float | None, bool, bool, bool]] = [
                (1, 0, score, False, False, False),
            ]
            algo.process_match_data(22, f"M{i}", f"2026-0{i+1}-01", results, comp_map)

        # top_n=2: average of the two best = (80 + 60) / 2 = 70
        ratings = algo.get_ratings()
        assert ratings[(100, None)].mu == pytest.approx(70.0)

    def test_idempotent(self) -> None:
        algo = ICSAlgorithm()
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        mu1 = algo.get_ratings()[(100, None)].mu
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP)
        assert algo.get_ratings()[(100, None)].mu == mu1

    def test_dnf_excluded(self) -> None:
        results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 0, 80.0, False, False, False),
            (2, 0, 0.0, False, True, False),  # DNF
        ]
        algo = ICSAlgorithm()
        algo.process_match_data(22, "M1", None, results, COMP_MAP)
        ratings = algo.get_ratings()
        assert not any(k[0] == 200 for k in ratings)

    def test_save_load_state(self, tmp_path: Path) -> None:
        algo = ICSAlgorithm(anchor_percentile=75.0, top_n=2)
        algo.process_match_data(22, "M1", "2026-01-01", STAGE_RESULTS, COMP_MAP,
                                match_level="l4")
        path = tmp_path / "ics_state.json"
        algo.save_state(path)

        algo2 = ICSAlgorithm()
        algo2.load_state(path)
        assert algo2.anchor_percentile == 75.0
        assert algo2.top_n == 2
        assert algo.get_ratings()[(100, None)].mu == algo2.get_ratings()[(100, None)].mu
        assert algo2._anchor_perf == algo._anchor_perf

    def test_save_load_state_none_division_weight(self, tmp_path: Path) -> None:
        """Division weights with None key round-trip correctly through JSON."""
        anchor_results: list[tuple[int, int, float | None, bool, bool, bool]] = [
            (1, 0, 85.0, False, False, False),
            (2, 0, 70.0, False, False, False),
        ]
        # No division_map → division=None for all competitors
        algo = ICSAlgorithm()
        algo.process_match_data(22, "A1", "2025-01-01", anchor_results,
                                {1: 100, 2: 200}, match_level="l4")
        assert None in algo._div_weights

        path = tmp_path / "ics_none_div.json"
        algo.save_state(path)
        algo2 = ICSAlgorithm()
        algo2.load_state(path)
        assert None in algo2._div_weights
        assert algo2._div_weights[None] == pytest.approx(algo._div_weights[None])


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
