import math
from datetime import date

import pytest

from src.utils.gp_features_v4 import (
    QUALI_GAP_CAP,
    decayed_mean,
    finish_points,
    gp_features,
    is_dnf,
    long_run_gaps,
    neutralisation_rate,
    pace_gaps,
    quali_gaps,
)
from src.utils.race_history import load_history
from tests.support.fake_db import FakeConnection
from tests.support.race_history import quali_row, race_row, result_row, sample_history


class TestHelpers:
    def test_finish_points_use_the_modern_table_and_zero_outside_the_top_ten(self):
        assert [finish_points(p) for p in (1, 2, 10, 11, None)] == [25, 18, 1, 0, 0]

    @pytest.mark.parametrize("status,dnf", [
        ("Finished", False), ("Lapped", False), ("+1 Lap", False), ("Engine", True),
        ("Disqualified", True), ("Did not start", True), (None, True),
    ])
    def test_classified_finishes_are_not_dnfs(self, status, dnf):
        assert is_dnf(status) is dnf

    def test_decayed_mean_weights_recent_races_more(self):
        assert decayed_mean([1.0, 0.0]) == pytest.approx(1 / 1.85)
        assert decayed_mean([]) is None


class TestQualiGaps:
    def test_each_driver_is_measured_in_the_deepest_session_they_reached(self):
        gaps = quali_gaps([quali_row(1, 10, 1, 81000, 80000, 79000), quali_row(2, 10, 2, 81000, 80000, 79790),
                           quali_row(3, 20, 11, 81000, 80400), quali_row(4, 20, 16, 81810)])

        assert gaps[1] == 0.0
        assert gaps[2] == pytest.approx(1.0)
        assert gaps[3] == pytest.approx(0.5)
        assert gaps[4] == pytest.approx(1.0)

    def test_no_time_and_huge_gaps_are_capped(self):
        gaps = quali_gaps([quali_row(1, 10, 1, 80000), quali_row(2, 10, 2, 90000), quali_row(3, 20, 3)])

        assert gaps[2] == QUALI_GAP_CAP
        assert gaps[3] == QUALI_GAP_CAP


class TestLongRunGaps:
    def test_compares_on_the_same_compound_and_keeps_each_drivers_best(self):
        rows = [
            {"driver_id": 1, "compound": "SOFT", "median_lap_ms": 90000},
            {"driver_id": 2, "compound": "SOFT", "median_lap_ms": 90900},
            {"driver_id": 2, "compound": "HARD", "median_lap_ms": 92000},
            {"driver_id": 3, "compound": "HARD", "median_lap_ms": 92920},
        ]

        gaps = long_run_gaps(rows, [1, 2, 3, 4])

        assert gaps[1] == 0.0
        assert gaps[2] == 0.0  # fastest on HARD
        assert gaps[3] == pytest.approx(1.0)
        assert gaps[4] == pytest.approx(0.0)  # missing → field median of 0, 0, 1

    def test_a_session_too_thin_to_compare_gives_no_signal(self):
        assert long_run_gaps([{"driver_id": 1, "compound": "SOFT", "median_lap_ms": 90000}], [1, 2, 3]) == {
            1: 0.0, 2: 0.0, 3: 0.0,
        }


def test_pace_gaps_are_percent_off_the_fastest_median():
    assert pace_gaps([{"driver_id": 1, "median_lap_ms": 90000}, {"driver_id": 2, "median_lap_ms": 90900}]) == {
        1: 0.0, 2: pytest.approx(1.0),
    }


class TestNeutralisationRate:
    def test_shrinks_a_circuits_own_rate_toward_all_circuits(self):
        h = sample_history(races={
            1: race_row(1, date(2025, 3, 1), circuit_id=1, neutralised=True),
            2: race_row(2, date(2025, 4, 1), circuit_id=2, neutralised=False),
            3: race_row(3, date(2025, 5, 1), circuit_id=2, neutralised=False),
            4: race_row(4, date(2025, 6, 1), circuit_id=2, neutralised=True),
        })

        # Overall 2/4; circuit 1 has 1/1 → (1 + 3 × 0.5) / (1 + 3)
        assert neutralisation_rate(h, [4, 3, 2, 1], circuit_id=1) == pytest.approx(0.625)

    def test_races_before_safety_car_data_existed_are_ignored(self):
        h = sample_history(races={1: race_row(1, date(2015, 3, 1), neutralised=False)})

        assert neutralisation_rate(h, [1], circuit_id=1) == 0.5


class TestGpFeatures:
    def test_scores_this_weekend_from_the_grid_and_qualifying(self):
        f = gp_features(sample_history(), 3)

        assert f[1]["grid"] == 0.0
        assert f[3]["grid"] == pytest.approx(-math.log(3))
        assert f[4]["grid"] == pytest.approx(-math.log(20))  # no grid slot → back of the grid
        assert f[2]["quali_pace"] == pytest.approx(-0.2)
        assert f[1]["grid_processional"] == 0.0
        assert f[3]["grid_processional"] == pytest.approx(-math.log(3) * 0.8)

    def test_form_comes_from_earlier_races_across_people_and_outfits(self):
        f = gp_features(sample_history(), 3)

        assert f[1]["driver_points"] == 25.0
        # Driver 2: 18 in race 1, a DNF in race 2 (most recent, weight 1) → (0 + 0.85 × 18) / 1.85
        assert f[2]["driver_points"] == pytest.approx(0.85 * 18 / 1.85)
        assert f[1]["teammate_edge"] > 0 > f[2]["teammate_edge"]
        assert f[1]["team_quali_pace"] == 0.0 == f[2]["team_quali_pace"]
        assert f[3]["team_race_pace"] == pytest.approx(-2.0)

    def test_a_rookie_has_no_form_but_shares_their_teams(self):
        f = gp_features(sample_history(), 3)

        assert f[4]["driver_points"] == 0.0
        assert f[4]["teammate_edge"] == 0.0
        assert f[4]["team_quali_pace"] == f[3]["team_quali_pace"]

    def test_never_reads_the_race_being_predicted_or_later(self):
        h = sample_history()
        h.results[3] = [result_row(3, 20, 1)]  # a result that must not count toward race 3's form
        h.races[4] = race_row(4, date(2026, 5, 1))
        h.results[4] = [result_row(3, 20, 1)]

        f = gp_features(h, 3)

        assert f[3]["driver_points"] == pytest.approx((18 + 0.85 * 15) / 1.85)

    def test_a_race_without_qualifying_cannot_be_scored(self):
        with pytest.raises(ValueError, match="No qualifying results for race 3"):
            gp_features(sample_history(quali={}), 3)


class TestLoadHistory:
    def test_groups_rows_by_race_and_resolves_people_and_outfits(self):
        conn = FakeConnection([
            [race_row(1, date(2026, 3, 1))],
            [{"race_id": 1, **result_row(1, 10, 1)}],
            [{"race_id": 1, **quali_row(1, 10, 1, 80000)}],
            [],
            [],
            [{"race_id": 1, "driver_id": 1, "median_lap_ms": 90000}],
            [{"id": 1, "team_id": 10, "code": "VER", "first_name": "Max", "last_name": "Verstappen"}],
            [{"id": 10, "team_key": "red_bull_racing"}],
        ])

        h = load_history(conn, since=date(2023, 1, 1))

        assert h.results[1][0]["finish_position"] == 1
        assert h.quali[1][0]["q1_time_ms"] == 80000
        assert h.race_pace[1][0]["median_lap_ms"] == 90000
        assert h.person == {1: "max verstappen"}
        assert h.outfit == {10: "red_bull_racing"}
        assert h.team_of == {1: 10}
        assert conn.cursors[0].executed[0][1] == (date(2023, 1, 1), date.max)
