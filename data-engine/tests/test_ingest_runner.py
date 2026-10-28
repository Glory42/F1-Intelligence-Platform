from datetime import date, datetime, timedelta, timezone

import pytest

import src.utils.ingest_runner as ingest_runner
from src.utils.ingest_runner import (
    IngestJobConfig,
    QualifyingContext,
    QualifyingJobConfig,
    RaceContext,
    run_ingest_job,
    run_openf1_job,
    run_qualifying_ingest_job,
)
from src.utils.openf1_session import OpenF1Session
from src.utils.storage_guard import StorageTier
from tests.support.fake_db import FakeConnection

_RESULT_ROWS = [
    {
        "driver_code": "VER",
        "finish_position": 1,
        "grid_position": 1,
        "points": 25.0,
        "status": "Finished",
        "total_race_time_ms": 5400000,
        "fastest_lap": True,
        "headshot_url": None,
    },
    {
        "driver_code": "HAM",
        "finish_position": 2,
        "grid_position": 2,
        "points": 18.0,
        "status": "Finished",
        "total_race_time_ms": 5405000,
        "fastest_lap": False,
        "headshot_url": None,
    },
]

_LAP_ROWS = [
    {
        "driver_code": "VER",
        "lap_number": 1,
        "lap_time_ms": 90000,
        "sector1_ms": 30000,
        "sector2_ms": 30000,
        "sector3_ms": 30000,
        "speed_st": 300.0,
        "compound": "SOFT",
        "tyre_life": 1,
        "fresh_tyre": True,
        "is_pit_lap": False,
        "stint_number": 1,
    },
]

_DRIVER_MAP = {"VER": 1, "HAM": 2}
_RACE_DATE = date(2026, 5, 3)


def _patch_race_session_helpers(monkeypatch, **overrides):
    defaults = {
        "load_session": lambda year, race_date, session_type, parts: OpenF1Session(session_key=1),
        "fetch_classification": lambda year, round_num, sprint=False: [],
        "is_complete": lambda session, classification, session_type: True,
        "weather_label": lambda session: "Dry",
        "weather_details": lambda session: {
            "air_temp_avg": 25.0,
            "track_temp_avg": 35.0,
            "humidity_avg": 50.0,
        },
        "safety_car_laps": lambda session: {"safety_car_laps": 0, "vsc_laps": 0},
        "race_results": lambda session, classification: _RESULT_ROWS,
        "lap_times": lambda session: _LAP_ROWS,
        "lap_records": lambda session: [],
        "session_weather_trace": lambda session: None,
        "read_storage_tier": lambda conn: StorageTier.ALLOW_ALL,
        "session_entries": lambda session: ["entry"],
        "register_session_drivers": lambda conn, season_id, entries: dict(_DRIVER_MAP),
    }
    defaults.update(overrides)
    for name, fn in defaults.items():
        monkeypatch.setattr(ingest_runner, name, fn)


def _spy(calls):
    def fn(*args, **kwargs):
        calls.append((args, kwargs))

    return fn


class TestRunIngestJob:
    def _config(self, **overrides):
        defaults = dict(
            job_name="test_ingest_job",
            session_type="R",
            session_label="Race",
            results_table="race_results",
            lap_times_table="lap_times",
            time_field="total_sprint_time_ms",  # deliberately distinct from the source dict's
            # own "total_race_time_ms" key, to prove the row-building loop maps through
            # config.time_field rather than hardcoding a column name
            results_row_label="race result",
            laps_row_label="lap time",
            no_results_error="No results for race {race_id}",
            resolve_race=lambda conn, year, round_num: RaceContext(race_id=1, season_id=10, race_date=_RACE_DATE),
            mark_status=lambda conn, ctx, weather, weather_details, sc_vsc: None,
        )
        defaults.update(overrides)
        return IngestJobConfig(**defaults)

    def test_happy_path_upserts_results_and_laps_and_commits(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        mark_status_calls = []
        config = self._config(
            mark_status=lambda conn, ctx, weather, weather_details, sc_vsc: mark_status_calls.append(
                (ctx, weather, weather_details, sc_vsc)
            )
        )
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_ingest_job(2026, 5, config)

        assert len(upsert_calls) == 2
        (conn0, table0, rows0, conflict0), _ = upsert_calls[0]
        assert table0 == "race_results"
        assert conflict0 == ["race_id", "driver_id"]
        assert rows0[0]["total_sprint_time_ms"] == 5400000
        assert "total_race_time_ms" not in rows0[0]

        (conn1, table1, rows1, conflict1), _ = upsert_calls[1]
        assert table1 == "lap_times"
        assert conflict1 == ["race_id", "driver_id", "lap_number"]
        assert rows1[0]["lap_time_ms"] == 90000

        assert len(mark_status_calls) == 1
        assert mark_status_calls[0][1] == "Dry"
        assert conn.commits == 1
        assert conn.closed is True

    def test_holds_no_database_connection_while_openf1_loads_the_session(self, monkeypatch):
        # OpenF1's paced requests take a while; an open connection meanwhile keeps Neon awake.
        opened = []

        def _get_conn():
            conn = FakeConnection([])
            opened.append(conn)
            return conn

        open_during_load = []

        def _load_session(year, race_date, session_type, parts):
            open_during_load.append(any(not c.closed for c in opened))
            return OpenF1Session(session_key=1)

        _patch_race_session_helpers(monkeypatch, load_session=_load_session)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)

        run_ingest_job(2026, 5, self._config())

        assert open_during_load == [False]
        assert all(c.closed for c in opened)

    @pytest.mark.parametrize("session_type, sprint", [("R", False), ("S", True)])
    def test_finds_the_session_by_race_date_and_reads_its_classification(self, monkeypatch, session_type, sprint):
        loads, classifications = [], []
        _patch_race_session_helpers(
            monkeypatch,
            load_session=lambda year, race_date, kind, parts: loads.append((year, race_date, kind, parts))
            or OpenF1Session(session_key=1),
            fetch_classification=lambda year, round_num, sprint=False: classifications.append((year, round_num, sprint)) or [],
        )
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([]))

        run_ingest_job(2026, 5, self._config(session_type=session_type))

        assert loads == [(2026, _RACE_DATE, session_type, ingest_runner.RACE_PARTS)]
        assert classifications == [(2026, 5, sprint)]

    def test_writes_one_lap_trace_row_per_driver_for_the_session(self, monkeypatch):
        records = [
            {"driver": "VER", "lap": 1, "position": 1, "time_ms": 100_000},
            {"driver": "HAM", "lap": 1, "position": 2, "time_ms": 101_200},
            {"driver": "VER", "lap": 2, "position": 1, "time_ms": 190_000},
            {"driver": "HAM", "lap": 2, "position": 2, "time_ms": 190_500},
        ]
        _patch_race_session_helpers(monkeypatch, lap_records=lambda session: records)
        writes = {}
        monkeypatch.setattr(ingest_runner, "upsert", lambda conn, table, rows, conflict, **k: writes.update({table: (rows, conflict)}))
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([]))

        run_ingest_job(2026, 5, self._config(session_type="S"))

        rows, conflict = writes["race_lap_traces"]
        assert conflict == ["race_id", "session_type", "driver_id"]
        assert sorted((r["driver_id"], r["session_type"], r["positions"], r["gaps_ms"]) for r in rows) == [
            (1, "sprint", [1, 1], [0, 0]),
            (2, "sprint", [2, 2], [1_200, 500]),
        ]

    def test_writes_the_session_weather_trace(self, monkeypatch):
        from src.utils.race_story import WeatherTrace

        trace = WeatherTrace(minute_offsets=[0, 1], air_temp_tenths=[250, 251], track_temp_tenths=[400, 398],
                             rainfall=[False, True])
        _patch_race_session_helpers(monkeypatch, session_weather_trace=lambda session: trace)
        writes = {}
        monkeypatch.setattr(ingest_runner, "upsert", lambda conn, table, rows, conflict, **k: writes.update({table: (rows, conflict)}))
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([]))

        run_ingest_job(2026, 5, self._config())

        rows, conflict = writes["race_weather_traces"]
        assert conflict == ["race_id", "session_type"]
        assert rows == [{"race_id": 1, "session_type": "race", "minute_offsets": [0, 1], "air_temp_tenths": [250, 251],
                         "track_temp_tenths": [400, 398], "rainfall": [False, True]}]

    def test_cross_table_hook_runs_after_mark_status_when_configured(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        call_order = []
        config = self._config(
            mark_status=lambda *a: call_order.append("mark_status"),
            cross_table_hook=lambda conn, ctx: call_order.append("cross_table_hook"),
        )

        run_ingest_job(2026, 5, config)

        assert call_order == ["mark_status", "cross_table_hook"]

    def test_cross_table_hook_not_called_when_not_configured(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(cross_table_hook=None)

        run_ingest_job(2026, 5, config)

        assert conn.commits == 1

    def test_raises_when_session_data_invalid(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch, is_complete=lambda session, classification, session_type: False)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        with pytest.raises(RuntimeError, match="not fully available"):
            run_ingest_job(2026, 5, self._config())

        assert upsert_calls == []
        assert conn.commits == 0
        assert conn.closed is True

    def test_registers_the_sessions_drivers_before_mapping_results(self, monkeypatch):
        registered = []
        _patch_race_session_helpers(
            monkeypatch,
            register_session_drivers=lambda conn, season_id, entries: registered.append((season_id, entries)) or dict(_DRIVER_MAP),
        )
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([]))

        run_ingest_job(2026, 5, self._config())

        assert registered == [(10, ["entry"])]

    def test_a_result_for_a_driver_still_unknown_fails_instead_of_being_dropped(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch, register_session_drivers=lambda conn, season_id, entries: {"VER": 1})
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([]))

        with pytest.raises(RuntimeError, match="unknown driver HAM"):
            run_ingest_job(2026, 5, self._config())

        assert upsert_calls == []

    def test_headshot_backfill_only_for_rows_with_headshot_url(self, monkeypatch):
        result_rows = [
            {**_RESULT_ROWS[0], "headshot_url": "https://example.com/ver.jpg"},
            {**_RESULT_ROWS[1], "headshot_url": None},
        ]
        _patch_race_session_helpers(monkeypatch, race_results=lambda session, classification: result_rows)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        batch_calls = []
        monkeypatch.setattr(
            ingest_runner, "execute_batch", lambda cur, query, params, page_size=200: batch_calls.append(params)
        )
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_ingest_job(2026, 5, self._config())

        assert len(batch_calls) == 1
        assert batch_calls[0] == [("https://example.com/ver.jpg", 1)]

    def test_laps_upsert_skipped_when_no_lap_rows(self, monkeypatch):
        _patch_race_session_helpers(monkeypatch, lap_times=lambda session: [])
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_ingest_job(2026, 5, self._config())

        assert len(upsert_calls) == 1

    def test_conn_closed_even_when_resolve_race_raises(self, monkeypatch):
        get_session_calls = []
        _patch_race_session_helpers(
            monkeypatch, load_session=lambda *a: get_session_calls.append(1)
        )
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        def _raise(conn, year, round_num):
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            run_ingest_job(2026, 5, self._config(resolve_race=_raise))

        assert conn.closed is True
        assert get_session_calls == []


_QUALI_ROWS = [
    {
        "driver_code": "VER",
        "grid_position": 1,
        "q1_time_ms": 80000,
        "q2_time_ms": 79000,
        "q3_time_ms": 78000,
        "sector1_ms": 26000,
        "sector2_ms": 26000,
        "sector3_ms": 26000,
        "speed_st": 310.0,
    },
]


def _patch_quali_session_helpers(monkeypatch, **overrides):
    defaults = {
        "load_session": lambda year, race_date, session_type, parts: OpenF1Session(session_key=1),
        "qualifying_results": lambda session: _QUALI_ROWS,
        "session_entries": lambda session: ["entry"],
        "register_session_drivers": lambda conn, season_id, entries: dict(_DRIVER_MAP),
    }
    defaults.update(overrides)
    for name, fn in defaults.items():
        monkeypatch.setattr(ingest_runner, name, fn)


    def test_caches_the_session_key_for_the_weekends_later_jobs(self, monkeypatch):
        _patch_race_session_helpers(
            monkeypatch, load_session=lambda year, race_date, session_type, parts: OpenF1Session(session_key=9635),
        )
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_ingest_job(2026, 5, self._config(session_type="S"))

        updates = [(q, p) for cur in conn.cursors for q, p in cur.executed if q.startswith("UPDATE races")]
        assert updates == [("UPDATE races SET openf1_sprint_session_key = %s WHERE id = %s", (9635, 1))]


class TestRunQualifyingIngestJob:
    def _config(self, **overrides):
        defaults = dict(
            job_name="test_qual_job",
            results_table="qualifying_results",
            results_row_label="qualifying",
            allowed_event_formats=frozenset({"conventional"}),
            format_error="bad format '{event_format}' round {round_num}",
            date_guard_error="too early: {year} R{round_num} on {day}",
            no_results_error="no rows for {year} R{round_num} (race {race_id})",
            session_type_for=lambda event_format: "Q",
            resolve_race=lambda conn, year, round_num: QualifyingContext(
                race_id=1, season_id=10, event_format="conventional", quali_day=None, race_date=_RACE_DATE
            ),
            rows_from_quali=lambda quali_rows, driver_map, race_id: [
                {"race_id": race_id, "driver_id": 1, "grid_position": 1}
            ],
            new_status="qualifying_done",
            status_guard=("scheduled",),
        )
        defaults.update(overrides)
        return QualifyingJobConfig(**defaults)

    def test_happy_path_upserts_rows_and_bumps_status(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        rows_from_quali_calls = []

        def _rows_from_quali(quali_rows, driver_map, race_id):
            rows_from_quali_calls.append((quali_rows, driver_map, race_id))
            return [{"race_id": race_id, "driver_id": 1, "grid_position": 1}]

        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_qualifying_ingest_job(2026, 5, self._config(rows_from_quali=_rows_from_quali))

        assert rows_from_quali_calls == [(_QUALI_ROWS, _DRIVER_MAP, 1)]

        (conn_arg, table, rows, conflict), kwargs = upsert_calls[0]
        assert table == "qualifying_results"
        assert conflict == ["race_id", "driver_id"]
        assert kwargs["exclude_update"] is None

        query, params = conn.cursors[-1].executed[-1]
        assert params == ("qualifying_done", 1, ("scheduled",))
        assert conn.commits == 1
        assert conn.closed is True

    def test_holds_no_database_connection_while_openf1_loads_the_session(self, monkeypatch):
        opened = []

        def _get_conn():
            conn = FakeConnection([])
            opened.append(conn)
            return conn

        open_during_load = []

        def _load_session(year, race_date, session_type, parts):
            open_during_load.append(any(not c.closed for c in opened))
            return OpenF1Session(session_key=1)

        _patch_quali_session_helpers(monkeypatch, load_session=_load_session)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)

        run_qualifying_ingest_job(2026, 5, self._config())

        assert open_during_load == [False]
        assert all(c.closed for c in opened)

    def test_date_guard_raises_when_quali_day_in_future(self, monkeypatch):
        get_session_calls = []
        _patch_quali_session_helpers(
            monkeypatch, load_session=lambda *a, **k: get_session_calls.append(1)
        )
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)
        future_day = date.today() + timedelta(days=3)

        config = self._config(
            resolve_race=lambda conn, year, round_num: QualifyingContext(
                race_id=1, season_id=10, event_format="conventional", quali_day=future_day, race_date=_RACE_DATE
            )
        )

        with pytest.raises(RuntimeError, match="too early"):
            run_qualifying_ingest_job(2026, 5, config)

        assert get_session_calls == []

    def test_date_guard_skipped_when_quali_day_is_none(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_qualifying_ingest_job(2026, 5, self._config())  # default quali_day=None

        assert conn.commits == 1

    def test_format_guard_raises_for_unsupported_event_format(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(
            resolve_race=lambda conn, year, round_num: QualifyingContext(
                race_id=1, season_id=10, event_format="unknown", quali_day=None, race_date=_RACE_DATE
            )
        )

        with pytest.raises(ValueError, match="bad format"):
            run_qualifying_ingest_job(2026, 5, config)

    def test_registers_the_sessions_drivers_before_building_rows(self, monkeypatch):
        registered = []
        _patch_quali_session_helpers(
            monkeypatch,
            register_session_drivers=lambda conn, season_id, entries: registered.append((season_id, entries)) or dict(_DRIVER_MAP),
        )
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([None]))

        run_qualifying_ingest_job(2026, 5, self._config())

        assert registered == [(10, ["entry"])]

    def test_raises_when_no_rows_survive_driver_map_lookup(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(rows_from_quali=lambda quali_rows, driver_map, race_id: [])

        with pytest.raises(RuntimeError, match="no rows for 2026 R5"):
            run_qualifying_ingest_job(2026, 5, config)

        assert upsert_calls == []

    def test_status_update_uses_in_clause_with_status_guard_tuple(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(status_guard=("scheduled", "sprint_done"))

        run_qualifying_ingest_job(2026, 5, config)

        query, params = conn.cursors[-1].executed[-1]
        assert "IN %s" in query
        assert params == ("qualifying_done", 1, ("scheduled", "sprint_done"))

    def test_session_type_for_drives_the_session_lookup(self, monkeypatch):
        session_type_calls = []
        _patch_quali_session_helpers(
            monkeypatch,
            load_session=lambda year, race_date, session_type, parts: session_type_calls.append(
                session_type
            ) or OpenF1Session(session_key=1),
        )
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(session_type_for=lambda event_format: "SS")

        run_qualifying_ingest_job(2026, 5, config)

        assert session_type_calls == ["SS"]

    def test_exclude_update_forwarded_to_upsert_when_configured(self, monkeypatch):
        _patch_quali_session_helpers(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(exclude_update=["finish_position", "points"])

        run_qualifying_ingest_job(2026, 5, config)

        _, kwargs = upsert_calls[0]
        assert kwargs["exclude_update"] == ["finish_position", "points"]


class TestRunOpenF1Job:
    """run_openf1_job end to end with a real job config (stints) against a fake DB and a fake OpenF1."""

    _LONG_AGO = datetime.now(timezone.utc) - timedelta(days=1)
    _JUST_NOW = datetime.now(timezone.utc) - timedelta(minutes=10)
    _STINT = {"driver_number": 16, "stint_number": 1, "compound": "MEDIUM", "lap_start": 1, "lap_end": 15,
              "tyre_age_at_start": 0}

    def _race_row(self, **overrides):
        row = {
            "id": 1, "season_id": 10, "race_date": date(2024, 11, 3), "race_date_utc": self._LONG_AGO,
            "sprint_date": None, "status": "completed", "openf1_race_session_key": None,
            "openf1_sprint_session_key": None,
        }
        row.update(overrides)
        return row

    def _run(self, monkeypatch, session_name="Race", stints=None, tier=StorageTier.ALLOW_ALL, **race):
        from src.jobs.ingest_stints import CONFIG
        from tests.support.fake_openf1 import FakeOpenF1, weekend

        opened = []

        def _get_conn():
            conn = FakeConnection([self._race_row(**race), [{"id": 160, "code": "LEC", "driver_number": 16}]])
            opened.append(conn)
            return conn

        open_during_requests = []

        def _stints(params, filters):
            open_during_requests.append(any(not c.closed for c in opened))
            return [self._STINT] if stints is None else stints

        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)
        monkeypatch.setattr(ingest_runner, "read_storage_tier", lambda conn: tier)
        upserts = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda conn, table, rows, conflict, commit=True:
                            upserts.append((table, rows, conflict)))
        openf1 = FakeOpenF1(monkeypatch, {"sessions": weekend(date(2024, 11, 3), first_key=9630), "stints": _stints})
        run_openf1_job(2024, 20, CONFIG, session_name=session_name)
        return opened, upserts, openf1, open_during_requests

    @staticmethod
    def _race_updates(opened):
        return [(q, p) for c in opened for cur in c.cursors for q, p in cur.executed if q.lstrip().startswith("UPDATE races")]

    def test_maps_the_sessions_records_to_rows_and_commits(self, monkeypatch):
        opened, upserts, _, _ = self._run(monkeypatch)

        [(table, rows, conflict)] = upserts
        assert table == "race_stints"
        assert conflict == ["race_id", "session_type", "driver_id", "stint_number"]
        assert rows == [{"race_id": 1, "session_type": "race", "driver_id": 160, "stint_number": 1,
                         "compound": "MEDIUM", "lap_start": 1, "lap_end": 15, "tyre_age_at_start": 0}]
        assert opened[-1].commits == 1
        assert all(c.closed for c in opened)

    def test_records_of_unknown_car_numbers_are_skipped(self, monkeypatch):
        _, upserts, _, _ = self._run(monkeypatch, stints=[{**self._STINT, "driver_number": 99}])

        assert upserts == []

    def test_finds_the_race_session_in_the_weekend_and_caches_its_key(self, monkeypatch):
        opened, _, openf1, _ = self._run(monkeypatch)

        assert ("stints", {"session_key": 9635}) in openf1.requests  # "Race", the sixth session
        [(query, params)] = self._race_updates(opened)
        assert "openf1_race_session_key" in query and params == (9635, 1)

    def test_a_sprint_reads_the_sprint_session_of_the_same_weekend(self, monkeypatch):
        opened, upserts, openf1, _ = self._run(monkeypatch, session_name="Sprint", sprint_date=self._LONG_AGO)

        assert ("stints", {"session_key": 9633}) in openf1.requests
        assert [r["session_type"] for r in upserts[0][1]] == ["sprint"]
        [(query, params)] = self._race_updates(opened)
        assert "openf1_sprint_session_key" in query and params == (9633, 1)

    def test_uses_the_cached_session_key_instead_of_looking_it_up(self, monkeypatch):
        opened, _, openf1, _ = self._run(monkeypatch, openf1_race_session_key=9590)

        assert openf1.paths() == ["stints"]
        assert openf1.requests[0][1] == {"session_key": 9590}
        assert self._race_updates(opened) == []

    def test_holds_no_database_connection_while_fetching_from_openf1(self, monkeypatch):
        # A connection held across OpenF1's paced HTTP calls keeps Neon Free compute awake.
        _, _, _, open_during_requests = self._run(monkeypatch)

        assert open_during_requests == [False]

    @pytest.mark.parametrize("race, session_name", [
        ({"status": "qualifying_done"}, "Race"),
        ({"race_date_utc": _JUST_NOW}, "Race"),
        ({"sprint_date": None}, "Sprint"),
        ({"sprint_date": _LONG_AGO, "race_date_utc": _JUST_NOW}, "Sprint"),
    ])
    def test_skips_without_spending_a_request(self, monkeypatch, race, session_name):
        opened, upserts, openf1, _ = self._run(monkeypatch, session_name=session_name, **race)

        assert (upserts, openf1.requests) == ([], [])
        assert opened[0].commits == 0

    def test_writes_nothing_once_neon_storage_reaches_the_core_only_tier(self, monkeypatch):
        _, upserts, openf1, _ = self._run(monkeypatch, tier=StorageTier.CORE_ONLY)

        assert upserts == []
        assert openf1.requests == []  # no OpenF1 request spent on data that can't be stored

    def test_raises_when_race_not_found(self, monkeypatch):
        from src.jobs.ingest_stints import CONFIG

        monkeypatch.setattr(ingest_runner, "get_conn", lambda: FakeConnection([None]))

        with pytest.raises(ValueError, match="Race not found"):
            run_openf1_job(2024, 20, CONFIG)
