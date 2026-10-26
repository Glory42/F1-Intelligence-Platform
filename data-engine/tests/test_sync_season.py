"""Covers sync_season.run: the season and round lookup, and handing the round's OpenF1 drivers to the shared
driver registry (code fallbacks and team keys are covered in test_driver_registry.py)."""
from unittest.mock import patch

import pytest

from src.jobs import sync_season
from src.jobs.sync_season import run
from src.utils.openf1_session import OpenF1Session
from tests.support.fake_db import FakeConnection


def _run(*, season_row={"season_id": 1, "race_date": "2025-03-16"}):
    conn = FakeConnection([season_row])
    registered = []
    loads = []
    session = OpenF1Session(session_key=1, drivers=[{"driver_number": 1}])
    with patch.object(sync_season, "load_session", side_effect=lambda *a: loads.append(a) or session), \
         patch.object(sync_season, "get_conn", return_value=conn), \
         patch.object(sync_season, "session_entries", return_value=["entry"]), \
         patch.object(sync_season, "register_session_drivers",
                      side_effect=lambda c, season_id, entries, update_existing: registered.append((season_id, entries, update_existing)) or {}):
        run(2025, 1)
    return conn, registered, loads


def test_missing_season_raises():
    with pytest.raises(ValueError, match="Season 2025 not found"):
        _run(season_row=None)


def test_registers_the_rounds_drivers_refreshing_known_ones_and_commits():
    conn, registered, loads = _run()

    assert loads == [(2025, "2025-03-16", "R", ("drivers",))]
    assert registered == [(1, ["entry"], True)]
    assert conn.commits == 1
    assert conn.closed


def test_a_round_missing_from_the_calendar_raises():
    with pytest.raises(ValueError, match="not on the calendar"):
        _run(season_row={"season_id": 1, "race_date": None})
