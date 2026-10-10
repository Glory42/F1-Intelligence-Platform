from datetime import datetime, timedelta, timezone

import src.jobs.ingest_qualifying_telemetry as job
from src.utils import openf1_client
from src.utils.storage_guard import StorageTier
from tests.support.fake_db import FakeConnection
from tests.support.openf1_fixtures import load_openf1_fixture

NORRIS, PIASTRI = 4, 81
LONG_AGO = datetime.now(timezone.utc) - timedelta(days=2)


def _race_row(**overrides):
    row = {"id": 7, "season_id": 3, "status": "completed", "qualifying_date": LONG_AGO,
           "sprint_qualifying_date": None, "track_length_km": 5.793}
    row.update(overrides)
    return row


_NOR_POLE_START = datetime.fromisoformat("2024-08-31T15:02:50.589000+00:00")


def _shifted(fixture: str, start: datetime) -> list[dict]:
    """The recorded NOR pole lap moved into any requested lap window, standing in for every driver."""
    offset = start - _NOR_POLE_START
    return [{**s, "date": (datetime.fromisoformat(s["date"]) + offset).isoformat()} for s in load_openf1_fixture(fixture)]


def _patch(monkeypatch, stored_driver_ids=(), fetched=None):
    conn = FakeConnection([_race_row(), [{"driver_id": d} for d in stored_driver_ids]])
    monkeypatch.setattr(job, "get_conn", lambda: conn)
    monkeypatch.setattr(job, "read_storage_tier", lambda conn: StorageTier.ALLOW_ALL)
    monkeypatch.setattr(job, "build_driver_number_map", lambda conn, season_id: {NORRIS: 40, PIASTRI: 81})
    monkeypatch.setattr(job, "get_session_key", lambda year, date, session_name: 9586)
    monkeypatch.setattr(job, "fetch_laps", lambda key: load_openf1_fixture("laps_2024_monza_qualifying"))

    def _car(key, driver_number, start, end):
        if fetched is not None:
            fetched.append(driver_number)
        return _shifted("car_data_2024_monza_q_nor_pole", start)

    monkeypatch.setattr(job, "fetch_car_data", _car)
    monkeypatch.setattr(job, "fetch_location", lambda key, n, start, e: _shifted("location_2024_monza_q_nor_pole", start))
    writes = {}
    monkeypatch.setattr(job, "upsert", lambda conn, table, rows, conflict: writes.update({table: (rows, conflict)}))
    return writes


class TestRun:
    def test_stores_each_drivers_fastest_lap_pole_sitter_first(self, monkeypatch):
        writes = _patch(monkeypatch)

        job.run(2024, 16)

        rows, conflict = writes["qualifying_lap_telemetry"]
        assert conflict == ["race_id", "session_type", "driver_id"]
        assert [(r["driver_id"], r["session_type"], r["lap_time_ms"]) for r in rows] == [(40, "Q", 79_327), (81, "Q", 79_436)]
        assert len(rows[0]["samples"].adapted["distanceM"]) == 580

    def test_skips_drivers_already_stored(self, monkeypatch):
        fetched = []
        writes = _patch(monkeypatch, stored_driver_ids=[40], fetched=fetched)

        job.run(2024, 16)

        assert fetched == [PIASTRI]
        assert [r["driver_id"] for r in writes["qualifying_lap_telemetry"][0]] == [81]

    def test_writes_what_it_fetched_when_the_cycle_budget_runs_out(self, monkeypatch):
        writes = _patch(monkeypatch)
        openf1_client.reset_request_budget(limit=3)  # laps + NOR car_data + NOR location
        monkeypatch.setattr(job, "fetch_laps", lambda key: openf1_client._spend_request() or load_openf1_fixture("laps_2024_monza_qualifying"))
        car, loc = job.fetch_car_data, job.fetch_location
        monkeypatch.setattr(job, "fetch_car_data", lambda *a: openf1_client._spend_request() or car(*a))
        monkeypatch.setattr(job, "fetch_location", lambda *a: openf1_client._spend_request() or loc(*a))

        job.run(2024, 16)

        assert [r["driver_id"] for r in writes["qualifying_lap_telemetry"][0]] == [40]
