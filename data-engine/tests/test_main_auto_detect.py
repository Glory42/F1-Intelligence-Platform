"""Covers main.auto_detect_round: one lookup per job, keyed on that job's session date and the
Race Statuses weekend_pipeline says it is due in. Exits 1 when no round matches, otherwise
returns (year, round_number) coerced to int, and always closes its connection."""
from datetime import date
from unittest.mock import patch

import pytest

from src import main
from tests.support.fake_db import FakeConnection


def _detect(job, year, rows):
    conn = FakeConnection([rows])
    with patch.object(main, "get_conn", return_value=conn):
        result = main.auto_detect_round(job, year)
    sql, params = conn.cursors[0].executed[0]
    return result, sql, params, conn


class TestAutoDetectRound:
    def test_ingest_race_finds_the_round_whose_qualifying_is_done(self):
        result, sql, params, _ = _detect("ingest_race", 2025, {"round_number": 14, "year": 2025})
        assert result == (2025, 14)
        assert "r.race_date::date <= %s" in sql
        assert params == (date.today(), ["qualifying_done"], 2025, 2025)

    def test_ingest_qualifying_keys_on_the_qualifying_day_before_it_is_ingested(self):
        _, sql, params, _ = _detect("ingest_qualifying", 2025, {"round_number": 1, "year": 2025})
        assert "COALESCE(r.qualifying_date::date, r.race_date::date - 1) <= %s" in sql
        assert params[1] == ["scheduled", "sprint_done"]

    def test_sprint_qualifying_keys_on_its_own_day_and_a_scheduled_weekend(self):
        _, sql, params, _ = _detect("ingest_sprint_qualifying", None, {"round_number": 6, "year": 2025})
        assert "r.sprint_qualifying_date::date <= %s" in sql
        assert params == (date.today(), ["scheduled"], None, None)

    def test_the_sprint_waits_for_sprint_qualifying(self):
        _, sql, params, _ = _detect("ingest_sprint", 2025, {"round_number": 6, "year": 2025})
        assert "r.sprint_date::date <= %s" in sql
        assert params[1] == ["sprint_qualifying_done"]

    def test_race_events_look_for_a_completed_race(self):
        _, _, params, _ = _detect("ingest_stints_sprint", 2025, {"round_number": 6, "year": 2025})
        assert params[1] == ["completed"]

    def test_coerces_year_and_round_to_ints_and_closes_the_connection(self):
        result, _, _, conn = _detect("ingest_race", 2025, {"round_number": "14", "year": "2025"})
        assert result == (2025, 14)
        assert conn.closed is True

    def test_exits_1_and_still_closes_the_connection_when_nothing_is_due(self):
        conn = FakeConnection([None])
        with patch.object(main, "get_conn", return_value=conn), pytest.raises(SystemExit) as exc:
            main.auto_detect_round("ingest_sprint", 2025)
        assert exc.value.code == 1
        assert conn.closed is True
