from unittest.mock import patch
import pytest

from src.jobs.compute_season_stats import _compute_driver_stats, _compute_team_stats
from tests.support.fake_db import FakeConnection


class TestComputeDriverStats:
    """Tests for driver season stats computation using FakeConnection."""

    @patch("src.jobs.compute_season_stats.upsert")
    def test_computes_driver_dnf_rate_and_aggregates(self, mock_upsert):
        # Driver 1: 10 races entered, 10 finished (no DNFs)
        # Driver 2: 10 races entered, 8 finished, 2 DNFs
        conn = FakeConnection([
            [  # Main race aggregates
                {
                    "driver_id": 1,
                    "races_entered": 10,
                    "races_finished": 10,
                    "wins": 5,
                    "podiums": 8,
                    "dnf_count": 0,
                    "total_points": "200.0",
                    "avg_finish": 2.1,
                    "avg_gain": 1.2,
                },
                {
                    "driver_id": 2,
                    "races_entered": 10,
                    "races_finished": 8,
                    "wins": 1,
                    "podiums": 3,
                    "dnf_count": 2,
                    "total_points": "80.0",
                    "avg_finish": 6.5,
                    "avg_gain": 0.5,
                },
            ],
            [  # Qualifying poles
                {"driver_id": 1, "poles": 6},
                {"driver_id": 2, "poles": 1},
            ],
            [  # Sprint aggregates
                {
                    "driver_id": 1,
                    "sprint_races_entered": 2,
                    "sprint_wins": 1,
                    "sprint_podiums": 2,
                    "sprint_total_points": "15.0",
                    "sprint_avg_finish": 1.5,
                },
            ],
            [  # Sector medians + top speed
                {
                    "driver_id": 1,
                    "med_s1": 28000,
                    "med_s2": 29000,
                    "med_s3": 27000,
                    "top_speed": 345.5,
                },
            ],
            [],  # Teammate quali delta queries
        ])

        _compute_driver_stats(conn, season_id=1)

        assert mock_upsert.called
        args, _ = mock_upsert.call_args
        _, table, rows, conflict_cols = args

        assert table == "driver_season_stats"
        assert conflict_cols == ["season_id", "driver_id"]
        assert len(rows) == 2

        d1 = next(r for r in rows if r["driver_id"] == 1)
        assert d1["dnf_count"] == 0
        assert d1["dnf_rate"] == 0.0
        assert d1["championship_position"] == 1
        assert d1["poles"] == 6
        assert d1["sprint_wins"] == 1

        d2 = next(r for r in rows if r["driver_id"] == 2)
        assert d2["dnf_count"] == 2
        assert d2["dnf_rate"] == 0.2
        assert d2["championship_position"] == 2
        assert d2["poles"] == 1

    @patch("src.jobs.compute_season_stats.upsert")
    def test_championship_position_counts_sprint_points(self, mock_upsert):
        # Driver 1 leads on grand prix points (200 vs 195), but driver 2's 15 sprint points
        # make it 200 vs 210 in the actual championship.
        race_agg = {"races_entered": 10, "races_finished": 10, "wins": 0, "podiums": 0, "dnf_count": 0,
                    "avg_finish": 5.0, "avg_gain": 0.0}
        conn = FakeConnection([
            [{"driver_id": 1, "total_points": "200.0", **race_agg}, {"driver_id": 2, "total_points": "195.0", **race_agg}],
            [],
            [{"driver_id": 2, "sprint_races_entered": 3, "sprint_wins": 1, "sprint_podiums": 2,
              "sprint_total_points": "15.0", "sprint_avg_finish": 2.0}],
            [],
            [],
        ])

        _compute_driver_stats(conn, season_id=1)

        _, _, rows, _ = mock_upsert.call_args[0]
        positions = {r["driver_id"]: r["championship_position"] for r in rows}
        assert positions == {2: 1, 1: 2}

    @patch("src.jobs.compute_season_stats.upsert")
    def test_zero_races_entered_handles_dnf_rate_as_none(self, mock_upsert):
        conn = FakeConnection([
            [  # Driver with 0 entries
                {
                    "driver_id": 99,
                    "races_entered": 0,
                    "races_finished": 0,
                    "wins": 0,
                    "podiums": 0,
                    "dnf_count": 0,
                    "total_points": "0.0",
                    "avg_finish": None,
                    "avg_gain": None,
                },
            ],
            [],  # poles
            [],  # sprint
            [],  # sectors
            [],  # teammate quali
        ])

        _compute_driver_stats(conn, season_id=1)

        assert mock_upsert.called
        _, _, rows, _ = mock_upsert.call_args[0]
        assert len(rows) == 1
        assert rows[0]["dnf_rate"] is None


class TestComputeTeamStats:
    """Tests for team season stats computation and reliability scoring."""

    @patch("src.jobs.compute_season_stats.upsert")
    def test_computes_team_reliability_and_car_performance(self, mock_upsert):
        # Team 1: 24 total entries, 2 DNFs -> reliability = 1 - 2/24 = 0.91667
        # Team 2: 24 total entries, 6 DNFs -> reliability = 1 - 6/24 = 0.75
        conn = FakeConnection([
            [  # Team main race aggregates
                {
                    "team_id": 10,
                    "races_completed": 12,
                    "wins": 6,
                    "podiums": 14,
                    "dnf_count": 2,
                    "total_entries": 24,
                    "total_points": "350.0",
                    "avg_finish": 2.8,
                    "median_finish": 2.0,
                    "avg_grid": 2.5,
                },
                {
                    "team_id": 20,
                    "races_completed": 12,
                    "wins": 1,
                    "podiums": 4,
                    "dnf_count": 6,
                    "total_entries": 24,
                    "total_points": "120.0",
                    "avg_finish": 8.4,
                    "median_finish": 8.0,
                    "avg_grid": 7.8,
                },
            ],
            [  # Sprint team aggregates
                {
                    "team_id": 10,
                    "sprint_wins": 2,
                    "sprint_podiums": 3,
                    "sprint_total_points": "28.0",
                },
            ],
        ])

        _compute_team_stats(conn, season_id=1)

        assert mock_upsert.called
        args, _ = mock_upsert.call_args
        _, table, rows, conflict_cols = args

        assert table == "team_season_stats"
        assert conflict_cols == ["season_id", "team_id"]
        assert len(rows) == 2

        t1 = next(r for r in rows if r["team_id"] == 10)
        assert t1["dnf_count"] == 2
        assert t1["reliability_score"] == pytest.approx(1.0 - 2 / 24, abs=1e-4)
        assert t1["championship_position"] == 1
        assert t1["sprint_wins"] == 2

        t2 = next(r for r in rows if r["team_id"] == 20)
        assert t2["dnf_count"] == 6
        assert t2["reliability_score"] == pytest.approx(1.0 - 6 / 24, abs=1e-4)
        assert t2["championship_position"] == 2

    @patch("src.jobs.compute_season_stats.upsert")
    def test_constructor_championship_position_counts_sprint_points(self, mock_upsert):
        team_agg = {"races_completed": 10, "wins": 0, "podiums": 0, "dnf_count": 0, "total_entries": 20,
                    "avg_finish": 5.0, "median_finish": 5.0, "avg_grid": 5.0}
        conn = FakeConnection([
            [{"team_id": 10, "total_points": "300.0", **team_agg}, {"team_id": 20, "total_points": "290.0", **team_agg}],
            [{"team_id": 20, "sprint_wins": 2, "sprint_podiums": 4, "sprint_total_points": "30.0"}],
        ])

        _compute_team_stats(conn, season_id=1)

        _, _, rows, _ = mock_upsert.call_args[0]
        assert {r["team_id"]: r["championship_position"] for r in rows} == {20: 1, 10: 2}

    @patch("src.jobs.compute_season_stats.upsert")
    def test_empty_team_aggregates_skips_upsert(self, mock_upsert):
        conn = FakeConnection([[]])  # No team rows
        _compute_team_stats(conn, season_id=1)
        assert not mock_upsert.called
