from datetime import date

from src.jobs.ingest_fp2 import long_run_rows, select_practice_session
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session, practice_laps
from tests.support.fake_openf1 import FakeOpenF1, weekend

DRIVERS = SeasonDrivers(by_number={1: 7}, by_code={})


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

def test_holds_no_database_connection_while_openf1_loads_practice(monkeypatch):
    import src.jobs.ingest_fp2 as ingest_fp2
    from tests.support.fake_db import FakeConnection

    opened = []

    def _get_conn():
        conn = FakeConnection([{"id": 1, "season_id": 10, "event_format": "conventional", "race_date": "2026-10-04"}, []])
        opened.append(conn)
        return conn

    open_during_requests = []

    def _laps(params, filters):
        open_during_requests.append(any(not c.closed for c in opened))
        return []

    monkeypatch.setattr(ingest_fp2, "get_conn", _get_conn)
    openf1 = FakeOpenF1(monkeypatch, {"sessions": weekend(date(2026, 10, 4)), "laps": _laps})

    ingest_fp2.run(2026, 5)

    assert open_during_requests == [False]
    assert ("laps", {"session_key": 9001}) in openf1.requests  # Practice 2


def _lap(number, lap_number, seconds, *, out=False):
    return {"driver_number": number, "lap_number": lap_number, "lap_duration": seconds, "is_pit_out_lap": out}


def _practice(laps, stints):
    return practice_laps(OpenF1Session(session_key=1, laps=laps, stints=stints))


def _stint(number, stint_number, lap_start, lap_end, compound):
    return {"driver_number": number, "stint_number": stint_number, "lap_start": lap_start, "lap_end": lap_end,
            "compound": compound, "tyre_age_at_start": 0}


class TestLongRunRows:
    def test_median_of_laps_three_to_n_minus_one_shifted_to_a_medium_baseline(self):
        laps = [_lap(1, 1, 300.0, out=True), *(_lap(1, n, 100.0 + n) for n in range(2, 10))]
        [row] = long_run_rows(_practice(laps, [_stint(1, 1, 1, 9, "SOFT")]), DRIVERS, race_id=3, session_type="FP2")

        # Timed laps 2-9; trimmed to laps 4-8 (104-108 s), median 106 s, +500 ms for the soft.
        assert row == {"race_id": 3, "driver_id": 7, "compound": "SOFT", "session_type": "FP2",
                       "median_lap_ms": 106_500, "stint_length": 5, "fp2_best_lap_ms": 102_000}

    def test_a_pit_visit_splits_one_tyre_set_into_separate_runs(self):
        laps = [_lap(1, n, 100.0) for n in range(1, 5)] + [_lap(1, 5, 400.0, out=True)] + [_lap(1, n, 101.0) for n in range(6, 10)]

        assert long_run_rows(_practice(laps, [_stint(1, 1, 1, 9, "MEDIUM")]), DRIVERS, race_id=3, session_type="FP2") == []

    def test_keeps_the_best_median_per_compound(self):
        laps = [_lap(1, n, 100.0) for n in range(1, 8)] + [_lap(1, 8, 300.0, out=True)] + [_lap(1, n, 99.0) for n in range(9, 16)]
        stints = [_stint(1, 1, 1, 7, "HARD"), _stint(1, 2, 8, 15, "HARD")]

        [row] = long_run_rows(_practice(laps, stints), DRIVERS, race_id=3, session_type="FP2")
        assert row["median_lap_ms"] == 99_000 - 400

    def test_skips_unknown_drivers_and_untracked_compounds(self):
        laps = [_lap(1, n, 100.0) for n in range(1, 9)] + [_lap(2, n, 100.0) for n in range(1, 9)]
        stints = [_stint(1, 1, 1, 8, "INTERMEDIATE"), _stint(2, 1, 1, 8, "MEDIUM")]

        assert long_run_rows(_practice(laps, stints), DRIVERS, race_id=3, session_type="FP2") == []
