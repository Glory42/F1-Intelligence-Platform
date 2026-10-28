from datetime import date

from src.utils.feature_helpers import compute_luck_score, same_person_rows
from tests.support.fake_db import FakeConnection


class TestSamePersonRows:
    def test_pairs_each_driver_with_every_row_of_the_same_person_not_the_same_code(self):
        conn = FakeConnection([[
            {"id": 1, "code": "VER", "first_name": "Max", "last_name": "Verstappen"},
            {"id": 7, "code": "VER", "first_name": "Max", "last_name": "Verstappen"},
            {"id": 8, "code": "VER", "first_name": "Jean-Eric", "last_name": "Vergne"},
            {"id": 2, "code": "MSC", "first_name": "Mick", "last_name": "Schumacher"},
        ]])

        current, history = same_person_rows(conn, [1, 2])

        assert sorted(zip(current, history)) == [(1, 1), (1, 7), (2, 2)]

    def test_a_driver_missing_from_the_drivers_table_still_matches_itself(self):
        current, history = same_person_rows(FakeConnection([[]]), [5])

        assert (current, history) == ([5], [5])


class TestComputeLuckScore:
    def test_driver_with_no_recent_races_gets_zero_delta_and_loses_normalization(self):
        conn = FakeConnection([
            [
                {"driver_id": 1, "grid_position": 2, "finish_position": 1},
                {"driver_id": 1, "grid_position": 3, "finish_position": 2},
            ],
        ])

        result = compute_luck_score(
            conn,
            ([1, 2], [1, 2]),
            [1, 2],
            date(2025, 1, 1),
            team_perf={10: 0.8, 20: 0.3},
            stats_rows={1: {"team_id": 10}, 2: {"team_id": 20}},
        )

        # Driver 1 outperformed expectations (positive delta), driver 2 has no
        # recent results (delta 0.0) -> normalized to the extremes.
        assert result[1] == 1.0
        assert result[2] == 0.0
