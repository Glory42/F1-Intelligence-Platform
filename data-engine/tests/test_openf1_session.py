"""Covers openf1_session: OpenF1 + Jolpica rows shaped like the FastF1 helpers' output. The
Bahrain 2026 race (rain, a VSC turning into a Safety Car, two retirements) is recorded for four
drivers; expected values are the official results and what FastF1 ingested for that race."""
import json
from pathlib import Path

import pytest

import src.utils.openf1_session as openf1_session
from src.utils.openf1_session import (
    OpenF1Session,
    is_complete,
    lap_records,
    lap_times,
    load_session,
    neutralisations,
    qualifying_results,
    race_results,
    safety_car_laps,
    session_weather_trace,
    weather_details,
    weather_label,
)
from tests.support.openf1_fixtures import load_openf1_fixture

_JOLPICA = Path(__file__).resolve().parent / "fixtures" / "jolpica"


def _bahrain_race() -> OpenF1Session:
    return OpenF1Session(
        session_key=11731,
        drivers=load_openf1_fixture("drivers_2026_bahrain_race"),
        laps=load_openf1_fixture("laps_2026_bahrain_race"),
        stints=load_openf1_fixture("stints_2026_bahrain_race"),
        pits=load_openf1_fixture("pit_2026_bahrain_race"),
        weather=load_openf1_fixture("weather_2026_bahrain_race"),
        race_control=load_openf1_fixture("race_control_2026_bahrain_race"),
    )


def _bahrain_classification() -> list[dict]:
    return json.loads((_JOLPICA / "results_2026_bahrain.json").read_text())


def _message(date: str, message: str, *, flag=None, scope=None) -> dict:
    return {"date": f"2026-10-04T{date}+00:00", "message": message, "flag": flag, "scope": scope}


class TestLoadSession:
    def test_finds_the_session_by_weekend_then_fetches_each_part(self, monkeypatch):
        lookups, fetched = [], []
        monkeypatch.setattr(openf1_session.openf1_client, "find_weekend_session_key",
                            lambda year, race_date, names: lookups.append((year, race_date, names)) or 11379)
        monkeypatch.setattr(openf1_session.openf1_client, "fetch_session_data",
                            lambda endpoint, key: fetched.append((endpoint, key)) or [{"endpoint": endpoint}])

        session = load_session(2026, "2026-10-11", "SQ", ("drivers", "results"))

        assert lookups == [(2026, "2026-10-11", ("Sprint Qualifying", "Sprint Shootout"))]
        assert fetched == [("drivers", 11379), ("session_result", 11379)]
        assert session.results == [{"endpoint": "session_result"}]
        assert session.laps == []


class TestNeutralisations:
    def test_a_vsc_turning_into_a_safety_car_is_two_back_to_back_periods(self):
        periods = neutralisations(load_openf1_fixture("race_control_2026_bahrain_race"))

        assert [(p.kind, p.start.strftime("%H:%M:%S"), p.end.strftime("%H:%M:%S")) for p in periods] == [
            ("SC", "08:52:16", "09:00:16"),
            ("VSC", "09:53:01", "09:58:26"),
            ("SC", "09:58:26", "10:13:20"),
        ]

    def test_reads_2023_virtual_safety_car_wording_and_red_flags(self):
        periods = neutralisations([
            _message("10:00:00", "VIRTUAL SAFETY CAR DEPLOYED"),
            _message("10:02:00", "TRACK CLEAR", flag="CLEAR", scope="Track"),
            _message("10:10:00", "RED FLAG", flag="RED", scope="Track"),
            _message("10:40:00", "GREEN LIGHT - PIT EXIT OPEN", flag="GREEN", scope="Track"),
        ])

        assert [p.kind for p in periods] == ["VSC", "RED"]

    def test_a_period_still_running_at_the_end_of_the_feed_stays_open(self):
        [period] = neutralisations([_message("10:00:00", "SAFETY CAR DEPLOYED")])

        assert period.end is None

    def test_a_sector_clear_does_not_end_a_safety_car(self):
        [period] = neutralisations([
            _message("10:00:00", "SAFETY CAR DEPLOYED"),
            _message("10:01:00", "CLEAR IN TRACK SECTOR 4", flag="CLEAR", scope="Sector"),
        ])

        assert period.end is None


class TestRaceConditions:
    def test_counts_laps_any_car_ran_under_safety_car_and_vsc(self):
        assert safety_car_laps(_bahrain_race()) == {"safety_car_laps": 11, "vsc_laps": 3}

    def test_weather_matches_what_fastf1_reported(self):
        session = _bahrain_race()

        assert weather_label(session) == "mixed"
        assert weather_details(session) == {"air_temp_avg": 26.8, "track_temp_avg": 34.4, "humidity_avg": 82.7}

    def test_weather_trace_counts_minutes_from_the_first_sample(self):
        trace = session_weather_trace(_bahrain_race())

        assert trace.minute_offsets[0] == 0
        assert len(trace.minute_offsets) == len(trace.rainfall) == len(load_openf1_fixture("weather_2026_bahrain_race"))
        assert any(trace.rainfall)

    def test_no_weather_samples_is_dry_with_no_trace(self):
        session = OpenF1Session(session_key=1)

        assert weather_label(session) == "dry"
        assert weather_details(session) == {"air_temp_avg": None, "track_temp_avg": None, "humidity_avg": None}
        assert session_weather_trace(session) is None


class TestLapTimes:
    def test_keeps_the_same_accurate_laps_fastf1_picked(self):
        laps = [r["lap_number"] for r in lap_times(_bahrain_race()) if r["driver_code"] == "VER"]

        # Lap 1, 2 (no sector 3), the Safety Car and VSC periods and the pit stop at 33/34 are out.
        assert laps == [*range(3, 9), *range(13, 33), *range(35, 43), *range(52, 56)]

    def test_reads_times_in_ms_and_the_tyre_from_the_stint(self):
        first = next(r for r in lap_times(_bahrain_race()) if r["driver_code"] == "VER")

        assert first == {
            "driver_code": "VER", "lap_number": 3, "lap_time_ms": 114550,
            "sector1_ms": 32153, "sector2_ms": 37928, "sector3_ms": 44469, "speed_st": 266.0,
            "compound": "SOFT", "tyre_life": 1, "fresh_tyre": True, "is_pit_lap": False, "stint_number": 3,
        }

    def test_skips_laps_whose_sectors_do_not_add_up(self):
        lap = {"driver_number": 3, "lap_number": 5, "date_start": "2026-10-04T09:00:00+00:00", "lap_duration": 90.0,
               "duration_sector_1": 30.0, "duration_sector_2": 30.0, "duration_sector_3": 29.9, "is_pit_out_lap": False}
        session = OpenF1Session(session_key=1, drivers=load_openf1_fixture("drivers_2026_bahrain_race"), laps=[lap])

        assert lap_times(session) == []


class TestLapRecords:
    def test_ranks_each_lap_by_when_cars_crossed_the_line(self):
        records = [r for r in lap_records(_bahrain_race()) if r["lap"] == 1]

        assert [(r["driver"], r["position"]) for r in records] == [("VER", 1), ("ANT", 2), ("RUS", 3), ("BOT", 4)]
        assert records[0]["time_ms"] == 152201

    def test_a_retirement_lap_with_no_time_is_left_out(self):
        records = lap_records(_bahrain_race())

        assert max(r["lap"] for r in records if r["driver"] == "BOT") == 7


class TestRaceResults:
    def test_matches_the_official_classification(self):
        rows = {r["driver_code"]: r for r in race_results(_bahrain_race(), _bahrain_classification())}

        assert {code: (r["finish_position"], r["grid_position"], r["points"], r["status"]) for code, r in rows.items()} == {
            "VER": (1, 1, 25.0, "Finished"),
            "ANT": (2, 3, 18.0, "Finished"),
            "RUS": (20, 7, 0.0, "Retired"),
            "BOT": (22, 19, 0.0, "Retired"),
        }

    def test_winner_gets_the_race_time_and_finishers_their_gap(self):
        rows = {r["driver_code"]: r for r in race_results(_bahrain_race(), _bahrain_classification())}

        assert rows["VER"]["total_race_time_ms"] == 6434808
        assert rows["ANT"]["total_race_time_ms"] == 2307
        assert rows["RUS"]["total_race_time_ms"] is None

    def test_fastest_lap_and_headshots_come_from_openf1(self):
        rows = {r["driver_code"]: r for r in race_results(_bahrain_race(), _bahrain_classification())}

        assert [code for code, r in rows.items() if r["fastest_lap"]] == ["VER"]
        assert rows["VER"]["headshot_url"].startswith("https://media.formula1.com/")


class TestIsComplete:
    def _classification(self, finishers: int, *, winner_time: bool = True) -> list[dict]:
        rows = [{"number": str(n), "position": str(n), "Time": {"millis": str(5_000_000 + n), "time": "+1"}}
                for n in range(1, finishers + 1)]
        if not winner_time:
            rows[0].pop("Time")
        return rows

    def _session(self, laps: int) -> OpenF1Session:
        return OpenF1Session(session_key=1, laps=[{"driver_number": 1, "lap_number": n} for n in range(laps)])

    def test_complete_race(self):
        assert is_complete(self._session(100), self._classification(20), "R")

    def test_too_few_classified_drivers(self):
        assert not is_complete(self._session(100), self._classification(9), "R")

    def test_winner_without_a_time(self):
        assert not is_complete(self._session(100), self._classification(20, winner_time=False), "R")

    @pytest.mark.parametrize("session_type, laps, complete", [("R", 99, False), ("S", 50, True), ("S", 49, False)])
    def test_minimum_lap_count_per_session(self, session_type, laps, complete):
        assert is_complete(self._session(laps), self._classification(20), session_type) is complete


class TestQualifyingResults:
    def _session(self) -> OpenF1Session:
        return OpenF1Session(
            session_key=11730,
            drivers=load_openf1_fixture("drivers_2026_bahrain_race"),
            results=load_openf1_fixture("session_result_2026_bahrain_qualifying"),
            laps=load_openf1_fixture("laps_2026_bahrain_qualifying"),
        )

    def test_reads_q1_q2_q3_and_best_sectors(self):
        rows = qualifying_results(self._session())

        assert rows[0] == {
            "driver_code": "VER", "grid_position": 1, "q1_time_ms": 96477, "q2_time_ms": 95696, "q3_time_ms": 95130,
            "sector1_ms": 24504, "sector2_ms": 31456, "sector3_ms": 39016, "speed_st": 310.0,
        }

    def test_a_q1_exit_has_no_later_times(self):
        bot = next(r for r in qualifying_results(self._session()) if r["driver_code"] == "BOT")

        assert (bot["grid_position"], bot["q2_time_ms"], bot["q3_time_ms"]) == (21, None, None)

    def test_a_single_duration_is_q1(self):
        session = OpenF1Session(
            session_key=1,
            drivers=load_openf1_fixture("drivers_2026_bahrain_race"),
            results=[{"driver_number": 3, "position": 1, "duration": 90.5}],
        )

        [row] = qualifying_results(session)
        assert (row["q1_time_ms"], row["q2_time_ms"], row["sector1_ms"]) == (90500, None, None)

    def test_an_unclassified_driver_is_skipped(self):
        session = OpenF1Session(
            session_key=1,
            drivers=load_openf1_fixture("drivers_2026_bahrain_race"),
            results=[{"driver_number": 3, "position": None, "duration": [None, None, None]}],
        )

        assert qualifying_results(session) == []
