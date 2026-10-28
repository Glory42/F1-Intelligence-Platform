from datetime import date, datetime, timedelta, timezone

import src.jobs.ingest_qualifying_telemetry as job
from src.utils import openf1_client
from src.utils.storage_guard import StorageTier
from tests.support.fake_db import FakeConnection
from tests.support.fake_openf1 import FakeOpenF1, weekend, window_of
from tests.support.openf1_fixtures import load_openf1_fixture

NORRIS, PIASTRI = 4, 81
LONG_AGO = datetime.now(timezone.utc) - timedelta(days=2)


def _race_row(**overrides):
    row = {"id": 7, "season_id": 3, "race_date": date(2024, 9, 1), "status": "completed",
           "qualifying_date": LONG_AGO, "sprint_qualifying_date": None, "track_length_km": 5.793}
    row.update(overrides)
    return row


_NOR_POLE_START = datetime.fromisoformat("2024-08-31T15:02:50.589000+00:00")


def _shifted(fixture: str, start: datetime) -> list[dict]:
    """The recorded NOR pole lap moved into any requested lap window, standing in for every driver."""
    offset = start - _NOR_POLE_START
    return [{**s, "date": (datetime.fromisoformat(s["date"]) + offset).isoformat()} for s in load_openf1_fixture(fixture)]


def _patch(monkeypatch, stored_driver_ids=()):
    conn = FakeConnection([
        _race_row(),
        [{"driver_id": d} for d in stored_driver_ids],
        [{"id": 40, "code": "NOR", "driver_number": NORRIS}, {"id": 81, "code": "PIA", "driver_number": PIASTRI}],
    ])
    monkeypatch.setattr(job, "get_conn", lambda: conn)
    monkeypatch.setattr(job, "read_storage_tier", lambda conn: StorageTier.ALLOW_ALL)

    def samples(fixture):
        return lambda params, filters: _shifted(fixture, window_of(filters)[0])

    openf1 = FakeOpenF1(monkeypatch, {
        "sessions": weekend(date(2024, 9, 1), ("Qualifying", "Race"), first_key=9586),
        "laps": load_openf1_fixture("laps_2024_monza_qualifying"),
        "car_data": samples("car_data_2024_monza_q_nor_pole"),
        "location": samples("location_2024_monza_q_nor_pole"),
    })
    writes = {}
    monkeypatch.setattr(job, "upsert", lambda conn, table, rows, conflict: writes.update({table: (rows, conflict)}))
    return writes, openf1


class TestRun:
    def test_stores_each_drivers_fastest_lap_pole_sitter_first(self, monkeypatch):
        writes, openf1 = _patch(monkeypatch)

        job.run(2024, 16)

        assert ("laps", {"session_key": 9586}) in openf1.requests
        rows, conflict = writes["qualifying_lap_telemetry"]
        assert conflict == ["race_id", "session_type", "driver_id"]
        assert [(r["driver_id"], r["session_type"], r["lap_time_ms"]) for r in rows] == [(40, "Q", 79_327), (81, "Q", 79_436)]
        assert len(rows[0]["samples"].adapted["distanceM"]) == 580

    def test_skips_drivers_already_stored(self, monkeypatch):
        writes, openf1 = _patch(monkeypatch, stored_driver_ids=[40])

        job.run(2024, 16)

        assert [params["driver_number"] for path, params in openf1.requests if path == "car_data"] == [PIASTRI]
        assert [r["driver_id"] for r in writes["qualifying_lap_telemetry"][0]] == [81]

    def test_writes_what_it_fetched_when_the_cycle_budget_runs_out(self, monkeypatch):
        writes, _ = _patch(monkeypatch)
        openf1_client.reset_request_budget(limit=4)  # sessions + laps + NOR car_data + NOR location

        job.run(2024, 16)

        assert [r["driver_id"] for r in writes["qualifying_lap_telemetry"][0]] == [40]
