import pytest

import src.jobs.compute_title_odds as compute_title_odds
from tests.support.fake_db import FakeConnection


def _season_rows():
    return [
        {"id": 5},
        [{"driver_id": 7, "team_id": 70, "points": 150.0}, {"driver_id": 8, "team_id": 80, "points": 50.0}],
        [
            {"id": 1, "round_number": 1, "status": "completed", "event_format": "conventional"},
            {"id": 2, "round_number": 2, "status": "qualifying_done", "event_format": "conventional"},
        ],
        [
            {"race_id": 1, "driver_id": 7, "win_probability": 0.6},
            {"race_id": 1, "driver_id": 8, "win_probability": 0.4},
            {"race_id": 2, "driver_id": 7, "win_probability": 0.3},
            {"race_id": 2, "driver_id": 8, "win_probability": 0.7},
        ],
        [],
    ]


class TestRun:
    def test_writes_driver_and_team_odds_for_the_latest_completed_round(self, monkeypatch):
        writes = {}
        monkeypatch.setattr(
            compute_title_odds, "upsert",
            lambda conn, table, rows, conflict_cols: writes.update({table: (rows, conflict_cols)}),
        )
        monkeypatch.setattr(compute_title_odds, "get_conn", lambda: FakeConnection(_season_rows()))

        compute_title_odds.run(2026)

        driver_rows, driver_conflict = writes["title_odds_drivers"]
        assert driver_conflict == ["season_id", "after_round", "driver_id"]
        assert [(r["driver_id"], r["after_round"], r["title_probability"]) for r in driver_rows] == [
            (7, 1, 1.0),
            (8, 1, 0.0),
        ]
        team_rows, _ = writes["title_odds_teams"]
        assert [(r["team_id"], r["title_probability"]) for r in team_rows] == [(70, 1.0), (80, 0.0)]
        assert driver_rows[0]["simulations"] == compute_title_odds.SIMULATIONS
