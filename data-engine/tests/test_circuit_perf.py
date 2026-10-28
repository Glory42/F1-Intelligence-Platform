from datetime import date

from src.utils.feature_helpers import compute_team_circuit_perf
from tests.support.fake_db import FakeConnection

DAY = date(2025, 1, 1)


def _perf(conn, driver_ids, category):
    same = (list(driver_ids), list(driver_ids))
    return compute_team_circuit_perf(conn, same, driver_ids, 10, DAY, category)


class TestComputeTeamCircuitPerf:
    def test_normalizes_category_scores_across_field(self):
        conn = FakeConnection([
            [  # category aggregation rows (21 - avg_finish relative, normalized after)
                {"driver_id": 1, "cat_avg": 2.0, "cat_n": 8},    # strongest
                {"driver_id": 2, "cat_avg": 10.0, "cat_n": 12},  # mid
                {"driver_id": 3, "cat_avg": 19.0, "cat_n": 20},  # weakest
            ],
        ])

        result = _perf(conn, [1, 2, 3], "high_downforce")

        # 21 - avg: 19, 11, 2 -> minmax -> 1.0, ~0.47, 0.0
        assert result[1]["score"] == 1.0
        assert result[3]["score"] == 0.0
        assert result[2]["score"] is not None and 0.0 < result[2]["score"] < 1.0
        assert result[1]["n"] == 8
        assert result[2]["n"] == 12
        assert result[3]["n"] == 20

    def test_below_min_races_is_none(self):
        conn = FakeConnection([
            # driver 1 has plenty, driver 2 has only 1 category race
            [
                {"driver_id": 1, "cat_avg": 3.0, "cat_n": 7},
                {"driver_id": 2, "cat_avg": 5.0, "cat_n": 1},
            ],
        ])

        result = _perf(conn, [1, 2], "street")

        # single valid driver -> normalize_minmax defaults to 0.5 (no spread)
        assert result[1]["score"] == 0.5
        assert result[2]["score"] is None  # below CAR_CIRCUIT_MIN_RACES
        assert result[2]["n"] == 1

    def test_high_speed_blends_speed_trap_telemetry(self):
        conn = FakeConnection([
            [  # finish averages
                {"driver_id": 1, "cat_avg": 3.0, "cat_n": 10},
                {"driver_id": 2, "cat_avg": 4.0, "cat_n": 10},
            ],
            [  # speed trap medians for high-speed
                {"driver_id": 1, "med_speed": 340.0},
                {"driver_id": 2, "med_speed": 348.0},
            ],
        ])

        result = _perf(conn, [1, 2], "high_speed")

        # Driver 1 had slightly better finish avg, Driver 2 had higher top speed
        # Both are valid and have scores blended between finish and speed trap
        assert result[1]["score"] is not None
        assert result[2]["score"] is not None
        assert 0.0 <= result[1]["score"] <= 1.0
        assert 0.0 <= result[2]["score"] <= 1.0