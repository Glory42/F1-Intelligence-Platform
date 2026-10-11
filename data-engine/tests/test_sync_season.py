"""Covers sync_season.run: the season lookup, and handing the round's drivers to the shared
driver registry (code fallbacks and team keys are covered in test_driver_registry.py)."""
from unittest.mock import MagicMock, patch

import pytest

from src.jobs import sync_season
from src.jobs.sync_season import run
from tests.support.fake_db import FakeConnection


def _run(*, season_row={"id": 1}):
    conn = FakeConnection([season_row])
    registered = []
    session = MagicMock()
    with patch.object(sync_season.fastf1, "get_session", return_value=session), \
         patch.object(sync_season, "get_conn", return_value=conn), \
         patch.object(sync_season, "session_entries", return_value=["entry"]), \
         patch.object(sync_season, "register_session_drivers",
                      side_effect=lambda c, season_id, entries, update_existing: registered.append((season_id, entries, update_existing)) or {}):
        run(2025, 1)
    return conn, registered


def test_missing_season_raises():
    with pytest.raises(ValueError, match="Season 2025 not found"):
        _run(season_row=None)


def test_registers_the_rounds_drivers_refreshing_known_ones_and_commits():
    conn, registered = _run()

    assert registered == [(1, ["entry"], True)]
    assert conn.commits == 1
    assert conn.closed
