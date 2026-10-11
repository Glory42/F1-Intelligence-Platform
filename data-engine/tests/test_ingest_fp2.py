from src.jobs.ingest_fp2 import select_practice_session


def test_conventional_weekend_uses_fp2():
    assert select_practice_session("conventional") == "FP2"


def test_missing_event_format_defaults_to_fp2():
    assert select_practice_session(None) == "FP2"


def test_sprint_weekend_falls_back_to_fp1():
    assert select_practice_session("sprint") == "FP1"


def test_sprint_qualifying_format_falls_back_to_fp1():
    assert select_practice_session("sprint_qualifying") == "FP1"


def test_sprint_shootout_format_falls_back_to_fp1():
    assert select_practice_session("sprint_shootout") == "FP1"

def test_holds_no_database_connection_while_fastf1_loads_practice(monkeypatch):
    import src.jobs.ingest_fp2 as ingest_fp2
    from tests.support.fake_db import FakeConnection

    opened = []

    def _get_conn():
        conn = FakeConnection([{"id": 1, "season_id": 10, "event_format": "conventional"}])
        opened.append(conn)
        return conn

    open_during_load = []

    class _NoLaps:
        laps = None

    def _load(year, round_num, event_format):
        open_during_load.append(any(not c.closed for c in opened))
        return _NoLaps(), "FP2"

    monkeypatch.setattr(ingest_fp2, "get_conn", _get_conn)
    monkeypatch.setattr(ingest_fp2, "build_driver_code_map", lambda conn, season_id: {})
    monkeypatch.setattr(ingest_fp2, "_load_practice_session", _load)

    ingest_fp2.run(2026, 5)

    assert open_during_load == [False]
