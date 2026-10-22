from datetime import date

import pytest

from src.utils.driver_map import build_driver_code_map, build_driver_number_map
from src.utils.feature_context import build_feature_context
from tests.support.fake_db import FakeConnection


RACE_DAY = date(2025, 5, 4)


def _race_row(**overrides):
    row = {
        "id": 1,
        "season_id": 2025,
        "race_date": RACE_DAY,
        "circuit_id": 5,
        "event_format": "conventional",
        "overtake_rate": "0.850",
        "sc_probability": "0.300",
    }
    row.update(overrides)
    return row


def _context_conn():
    return FakeConnection([
        _race_row(),
        [
            {"driver_id": 10, "grid_position": 1},
            {"driver_id": 11, "grid_position": 3},
        ],
        [  # GP aggregates; driver 99 raced earlier but isn't on this grid
            {"driver_id": 10, "team_id": 1, "races_entered": 5, "wins": 1, "total_points": "80",
             "avg_gain": 0.456, "dnf_count": 1},
            {"driver_id": 11, "team_id": 2, "races_entered": 5, "wins": 0, "total_points": "20",
             "avg_gain": None, "dnf_count": 0},
            {"driver_id": 99, "team_id": 2, "races_entered": 1, "wins": 0, "total_points": "0",
             "avg_gain": None, "dnf_count": 0},
        ],
        [{"driver_id": 10, "sprint_races_entered": 1, "sprint_wins": 1, "sprint_total_points": "8"}],
        [
            {"team_id": 1, "median_finish": 2.0, "avg_grid": 2.0, "total_entries": 10, "dnf_count": 1},
            {"team_id": 2, "median_finish": 12.0, "avg_grid": 12.0, "total_entries": 10, "dnf_count": 3},
        ],
    ])


class TestBuildFeatureContext:
    def test_assembles_context_from_race_grid_and_aggregates(self):
        conn = _context_conn()

        ctx = build_feature_context(
            conn, race_id=1, grid_table="qualifying_results", grid_not_found_message="no grid"
        )

        assert ctx.race_id == 1
        assert ctx.season_id == 2025
        assert ctx.circuit_id == 5
        assert ctx.overtake_rate == 0.850
        assert ctx.sc_probability == 0.300
        assert ctx.driver_ids == [10, 11]
        assert ctx.grid_map == {10: 1, 11: 3}
        assert ctx.start_pos_map[10] == pytest.approx(1.0)
        assert ctx.start_pos_map[11] == pytest.approx(0.9)
        assert set(ctx.stats_rows) == {10, 11}
        assert ctx.stats_rows[10] == {
            "driver_id": 10, "team_id": 1, "races_entered": 5, "wins": 1, "total_points": 80.0,
            "avg_position_gain": 0.46, "dnf_rate": 0.2,
            "sprint_races_entered": 1, "sprint_wins": 1, "sprint_total_points": 8.0,
        }
        assert ctx.stats_rows[11]["sprint_races_entered"] == 0
        assert ctx.team_data[2]["reliability"] == 0.7
        assert ctx.team_perf[1] > ctx.team_perf[2]

    def test_season_aggregates_only_count_races_before_this_one(self):
        conn = _context_conn()

        build_feature_context(conn, race_id=1, grid_table="qualifying_results", grid_not_found_message="no grid")

        aggregate_queries = [cur.executed[0] for cur in conn.cursors[2:]]
        assert len(aggregate_queries) == 3
        for query, params in aggregate_queries:
            assert "r.race_date < %s" in query
            assert params == (2025, RACE_DAY)

    def test_race_not_found_raises(self):
        conn = FakeConnection([None])

        with pytest.raises(ValueError, match="Race 999 not found"):
            build_feature_context(conn, race_id=999, grid_table="qualifying_results", grid_not_found_message="no grid")

    def test_empty_grid_raises_with_the_given_message(self):
        conn = FakeConnection([_race_row(), []])

        with pytest.raises(ValueError, match="no sprint grid"):
            build_feature_context(
                conn, race_id=1, grid_table="sprint_results", grid_not_found_message="no sprint grid"
            )

    def test_validate_race_runs_before_the_grid_lookup(self):
        conn = FakeConnection([_race_row(event_format="conventional"), []])

        def reject_non_sprint(race):
            if race["event_format"] != "sprint_qualifying":
                raise ValueError("not a sprint weekend")

        with pytest.raises(ValueError, match="not a sprint weekend"):
            build_feature_context(
                conn,
                race_id=1,
                grid_table="sprint_results",
                grid_not_found_message="no sprint grid",
                validate_race=reject_non_sprint,
            )
        # validate_race raised before the grid query ran -> only one cursor was opened.
        assert len(conn.cursors) == 1


class TestBuildDriverCodeMap:
    def test_maps_driver_code_to_id(self):
        conn = FakeConnection([
            [{"code": "VER", "id": 10}, {"code": "LEC", "id": 11}],
        ])

        result = build_driver_code_map(conn, season_id=2025)

        assert result == {"VER": 10, "LEC": 11}


class TestBuildDriverNumberMap:
    def test_maps_driver_number_to_id(self):
        conn = FakeConnection([
            [{"driver_number": 1, "id": 10}, {"driver_number": 16, "id": 11}],
        ])

        result = build_driver_number_map(conn, season_id=2025)

        assert result == {1: 10, 16: 11}
