from datetime import date, datetime, timedelta, timezone

import pytest

import src.utils.ingest_runner as ingest_runner
from src.utils.ingest_runner import (
    IngestJobConfig,
    OpenF1JobConfig,
    QualifyingContext,
    QualifyingJobConfig,
    RaceContext,
    run_ingest_job,
    run_openf1_job,
    run_qualifying_ingest_job,
)
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


def _patch_race_session_helpers(monkeypatch, **overrides):
    defaults = {
        "get_session": lambda year, round_num, session_type: object(),
        "validate_session_data": lambda session, session_type: True,
        "get_weather": lambda session: "Dry",
        "get_weather_details": lambda session: {
            "air_temp_avg": 25.0,
            "track_temp_avg": 35.0,
            "humidity_avg": 50.0,
        },
        "get_sc_vsc_laps": lambda session: {"safety_car_laps": 0, "vsc_laps": 0},
        "session_to_race_results": lambda session: _RESULT_ROWS,
        "session_to_lap_times": lambda session: _LAP_ROWS,
        "session_to_lap_records": lambda session: [],
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
            resolve_race=lambda conn, year, round_num: RaceContext(race_id=1, season_id=10),
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

    def test_holds_no_database_connection_while_fastf1_loads_the_session(self, monkeypatch):
        # A FastF1 session load takes minutes; an open connection meanwhile keeps Neon awake.
        opened = []

        def _get_conn():
            conn = FakeConnection([])
            opened.append(conn)
            return conn

        open_during_load = []

        def _get_session(year, round_num, session_type):
            open_during_load.append(any(not c.closed for c in opened))
            return object()

        _patch_race_session_helpers(monkeypatch, get_session=_get_session)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)

        run_ingest_job(2026, 5, self._config())

        assert open_during_load == [False]
        assert all(c.closed for c in opened)

    def test_writes_one_lap_trace_row_per_driver_for_the_session(self, monkeypatch):
        records = [
            {"driver": "VER", "lap": 1, "position": 1, "time_ms": 100_000},
            {"driver": "HAM", "lap": 1, "position": 2, "time_ms": 101_200},
            {"driver": "VER", "lap": 2, "position": 1, "time_ms": 190_000},
            {"driver": "HAM", "lap": 2, "position": 2, "time_ms": 190_500},
        ]
        _patch_race_session_helpers(monkeypatch, session_to_lap_records=lambda session: records)
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
        _patch_race_session_helpers(monkeypatch, validate_session_data=lambda session, session_type: False)
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
        _patch_race_session_helpers(monkeypatch, session_to_race_results=lambda session: result_rows)
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
        _patch_race_session_helpers(monkeypatch, session_to_lap_times=lambda session: [])
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_ingest_job(2026, 5, self._config())

        assert len(upsert_calls) == 1

    def test_conn_closed_even_when_resolve_race_raises(self, monkeypatch):
        get_session_calls = []
        _patch_race_session_helpers(
            monkeypatch, get_session=lambda year, round_num, session_type: get_session_calls.append(1)
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
        "get_session": lambda year, round_num, session_type, messages=False: object(),
        "session_to_quali_results": lambda session: _QUALI_ROWS,
        "session_entries": lambda session: ["entry"],
        "register_session_drivers": lambda conn, season_id, entries: dict(_DRIVER_MAP),
    }
    defaults.update(overrides)
    for name, fn in defaults.items():
        monkeypatch.setattr(ingest_runner, name, fn)


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
                race_id=1, season_id=10, event_format="conventional", quali_day=None
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

    def test_holds_no_database_connection_while_fastf1_loads_the_session(self, monkeypatch):
        opened = []

        def _get_conn():
            conn = FakeConnection([])
            opened.append(conn)
            return conn

        open_during_load = []

        def _get_session(year, round_num, session_type, messages=False):
            open_during_load.append(any(not c.closed for c in opened))
            return object()

        _patch_quali_session_helpers(monkeypatch, get_session=_get_session)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)

        run_qualifying_ingest_job(2026, 5, self._config())

        assert open_during_load == [False]
        assert all(c.closed for c in opened)

    def test_date_guard_raises_when_quali_day_in_future(self, monkeypatch):
        get_session_calls = []
        _patch_quali_session_helpers(
            monkeypatch, get_session=lambda *a, **k: get_session_calls.append(1)
        )
        conn = FakeConnection([])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)
        future_day = date.today() + timedelta(days=3)

        config = self._config(
            resolve_race=lambda conn, year, round_num: QualifyingContext(
                race_id=1, season_id=10, event_format="conventional", quali_day=future_day
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
                race_id=1, season_id=10, event_format="unknown", quali_day=None
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

    def test_session_type_for_drives_get_session_call(self, monkeypatch):
        session_type_calls = []
        _patch_quali_session_helpers(
            monkeypatch,
            get_session=lambda year, round_num, session_type, messages=False: session_type_calls.append(
                session_type
            ),
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
    _LONG_AGO = datetime.now(timezone.utc) - timedelta(days=1)
    _JUST_NOW = datetime.now(timezone.utc) - timedelta(minutes=10)

    def _race_row(self, **overrides):
        row = {
            "id": 1, "season_id": 10, "race_date": "2024-11-03",
            "race_date_utc": self._LONG_AGO, "status": "completed",
        }
        row.update(overrides)
        return row

    def _config(self, **overrides):
        defaults = dict(
            job_name="test_openf1_job",
            table="some_table",
            conflict_cols=["race_id", "date"],
            row_label="rows",
            fetch=lambda session_key: [{"date": "2024-11-03T14:00:00+00:00"}],
            to_rows=lambda raw, race_id, driver_map: ([{"race_id": race_id, "date": raw[0]["date"]}], 0),
        )
        defaults.update(overrides)
        return OpenF1JobConfig(**defaults)

    def _patch_openf1(self, monkeypatch, session_key=9636, driver_map=None, capture=None):
        def fake_get_session_key(year, session_date, session_name="Race"):
            if capture is not None:
                capture["year"] = year
                capture["session_date"] = session_date
                capture["session_name"] = session_name
            return session_key

        monkeypatch.setattr(ingest_runner, "get_session_key", fake_get_session_key)
        monkeypatch.setattr(
            ingest_runner, "build_driver_number_map", lambda conn, season_id: dict(driver_map or {})
        )
        monkeypatch.setattr(ingest_runner, "read_storage_tier", lambda conn: StorageTier.ALLOW_ALL)

    def test_happy_path_upserts_and_commits(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row()])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config())

        assert len(upsert_calls) == 1
        (conn_arg, table, rows, conflict_cols), _ = upsert_calls[0]
        assert table == "some_table"
        assert conflict_cols == ["race_id", "date"]
        assert rows[0]["race_id"] == 1
        assert conn.commits == 1
        assert conn.closed is True

    def test_passes_race_id_and_driver_map_to_to_rows(self, monkeypatch):
        self._patch_openf1(monkeypatch, driver_map={1: 100})
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([self._race_row()])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        captured = {}

        def to_rows(raw, race_id, driver_map):
            captured["race_id"] = race_id
            captured["driver_map"] = driver_map
            return [], 0

        run_openf1_job(2024, 20, self._config(to_rows=to_rows))

        assert captured["race_id"] == 1
        assert captured["driver_map"] == {1: 100}

    def test_no_rows_still_commits_without_upserting(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row()])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        config = self._config(to_rows=lambda raw, race_id, driver_map: ([], 3))

        run_openf1_job(2024, 20, config)

        assert upsert_calls == []
        assert conn.commits == 1

    def test_skips_when_race_not_completed(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row(status="qualifying_done")])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config())

        assert upsert_calls == []
        assert conn.commits == 0

    def test_skips_when_still_inside_openf1_live_window(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row(race_date_utc=self._JUST_NOW)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config())

        assert upsert_calls == []
        assert conn.commits == 0

    def test_raises_when_race_not_found(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        conn = FakeConnection([None])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        with pytest.raises(ValueError, match="Race not found"):
            run_openf1_job(2024, 20, self._config())

    def test_sprint_session_uses_sprint_date_and_forwards_session_name(self, monkeypatch):
        capture = {}
        self._patch_openf1(monkeypatch, capture=capture)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([self._race_row(sprint_date=self._LONG_AGO)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config(), session_name="Sprint")

        assert capture["session_name"] == "Sprint"
        assert capture["session_date"] == self._LONG_AGO

    def test_sprint_session_skips_when_race_has_no_sprint_date(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row(sprint_date=None)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config(), session_name="Sprint")

        assert upsert_calls == []
        assert conn.commits == 0

    def test_sprint_session_gates_on_the_same_race_date_utc_live_window(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append((a, k)))
        conn = FakeConnection([self._race_row(sprint_date=self._LONG_AGO, race_date_utc=self._JUST_NOW)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config(), session_name="Sprint")

        assert upsert_calls == []
        assert conn.commits == 0

    def test_default_session_name_uses_race_date(self, monkeypatch):
        capture = {}
        self._patch_openf1(monkeypatch, capture=capture)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([self._race_row()])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config())

        assert capture["session_name"] == "Race"
        assert capture["session_date"] == "2024-11-03"

    def test_holds_no_database_connection_while_fetching_from_openf1(self, monkeypatch):
        # A connection held across OpenF1's paced HTTP calls keeps Neon Free compute awake.
        self._patch_openf1(monkeypatch)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        opened = []

        def _get_conn():
            conn = FakeConnection([self._race_row()])
            opened.append(conn)
            return conn

        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)
        open_during_fetch = []

        def _fetch(session_key):
            open_during_fetch.append(any(not c.closed for c in opened))
            return [{"date": "2024-11-03T14:00:00+00:00"}]

        run_openf1_job(2024, 20, self._config(fetch=_fetch))

        assert open_during_fetch == [False]

    def test_uses_the_cached_session_key_instead_of_looking_it_up(self, monkeypatch):
        self._patch_openf1(monkeypatch)

        def _no_lookup(*args, **kwargs):
            raise AssertionError("session key was cached: /sessions must not be queried")

        monkeypatch.setattr(ingest_runner, "get_session_key", _no_lookup)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        conn = FakeConnection([self._race_row(openf1_race_session_key=9590)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)
        fetched = []

        run_openf1_job(2024, 20, self._config(
            fetch=lambda key: fetched.append(key) or [],
            to_rows=lambda raw, race_id, driver_map: ([], 0),
        ))

        assert fetched == [9590]

    def test_stores_a_newly_resolved_sprint_session_key_on_the_race(self, monkeypatch):
        self._patch_openf1(monkeypatch, session_key=9636)
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: None)
        opened = []

        def _get_conn():
            conn = FakeConnection([self._race_row(sprint_date=self._LONG_AGO)])
            opened.append(conn)
            return conn

        monkeypatch.setattr(ingest_runner, "get_conn", _get_conn)

        run_openf1_job(2024, 20, self._config(), session_name="Sprint")

        writes = [(q, p) for c in opened for cur in c.cursors for q, p in cur.executed if q.lstrip().startswith("UPDATE races")]
        assert len(writes) == 1
        query, params = writes[0]
        assert "openf1_sprint_session_key" in query
        assert params == (9636, 1)

    def test_tags_every_row_with_the_session_it_came_from(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append(a))
        conn = FakeConnection([self._race_row(sprint_date=self._LONG_AGO)])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config(), session_name="Sprint")

        (_, _, rows, _) = upsert_calls[0]
        assert [r["session_type"] for r in rows] == ["sprint"]


    def test_writes_nothing_once_neon_storage_reaches_the_core_only_tier(self, monkeypatch):
        self._patch_openf1(monkeypatch)
        monkeypatch.setattr(ingest_runner, "read_storage_tier", lambda conn: StorageTier.CORE_ONLY)
        upsert_calls = []
        monkeypatch.setattr(ingest_runner, "upsert", lambda *a, **k: upsert_calls.append(a))
        fetched = []
        conn = FakeConnection([self._race_row()])
        monkeypatch.setattr(ingest_runner, "get_conn", lambda: conn)

        run_openf1_job(2024, 20, self._config(fetch=lambda key: fetched.append(key) or []))

        assert upsert_calls == []
        assert fetched == []  # no OpenF1 request spent on data that can't be stored
