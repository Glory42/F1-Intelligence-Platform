from datetime import datetime, timezone

import pandas as pd

from src.utils import session_records
from src.utils.driver_registry import SeasonDrivers
from src.utils.fastf1_session import (
    lap_records, ms_to_int, pit_stops, race_control_messages, session_weather_trace, stints, telemetry_inputs,
)
from src.utils.telemetry import build_lap_telemetry

DRIVERS = SeasonDrivers(by_number={}, by_code={"HAM": 1, "VET": 2})


def stint_rows(laps, race_id, session_type):
    """FastF1 laps through the adapter and the row mapping the OpenF1 job uses too."""
    return session_records.stint_rows(stints(laps), DRIVERS, race_id, session_type)[0]


def pit_stop_rows(laps, race_id, session_type):
    return session_records.pit_stop_rows(pit_stops(laps), DRIVERS, race_id, session_type)[0]


def race_control_rows(messages, race_id, session_type):
    return session_records.race_control_rows(race_control_messages(messages), DRIVERS, race_id, session_type)[0]


def lap(driver, number, stint, compound="SOFT", tyre_life=None, pit_in=None, pit_out=None):
    return {
        "Driver": driver, "LapNumber": number, "Stint": stint, "Compound": compound,
        "TyreLife": tyre_life if tyre_life is not None else number, "PitInTime": pit_in, "PitOutTime": pit_out,
        "LapStartTime": pd.Timedelta(seconds=90 * (number - 1)),
        "LapStartDate": pd.Timestamp("2018-03-25 05:10:00") + pd.Timedelta(seconds=90 * (number - 1)),
    }


class TestStintRows:
    def test_groups_laps_into_stints_with_tyre_age_when_fitted(self):
        laps = [lap("HAM", 1, 1.0, "ULTRASOFT", 3), lap("HAM", 2, 1.0, "ULTRASOFT", 4),
                lap("HAM", 3, 2.0, "SOFT", 1), lap("HAM", 4, 2.0, "SOFT", 2), lap("XXX", 1, 1.0)]
        rows = stint_rows(laps, race_id=7, session_type="race")
        assert [(r["stint_number"], r["compound"], r["lap_start"], r["lap_end"], r["tyre_age_at_start"]) for r in rows] == [
            (1, "ULTRASOFT", 1, 2, 2), (2, "SOFT", 3, 4, 0),
        ]

    def test_puts_an_unnumbered_opening_lap_in_the_first_stint(self):
        # 2018 timing: lap 1 has no stint or tyre age; lap 2 reads TyreLife 4 on a used set.
        opening = {**lap("VET", 1, float("nan"), "nan"), "TyreLife": float("nan")}
        rows = stint_rows([opening, lap("VET", 2, 1.0, float("nan"), 4), lap("VET", 3, 1.0, "ULTRASOFT", 5)],
                          race_id=7, session_type="sprint")
        assert [(r["lap_start"], r["lap_end"], r["compound"], r["tyre_age_at_start"], r["session_type"]) for r in rows] == [
            (1, 3, "ULTRASOFT", 2, "sprint"),
        ]


class TestPitStopRows:
    def test_measures_pit_lane_time_from_in_lap_to_out_lap(self):
        laps = [lap("HAM", 1, 1.0), lap("HAM", 2, 1.0, pit_in=pd.Timedelta(seconds=170)),
                lap("HAM", 3, 2.0, pit_out=pd.Timedelta(seconds=192.5))]
        [row] = pit_stop_rows(laps, race_id=7, session_type="race")
        assert (row["lap_number"], row["pit_lane_ms"], row["stationary_ms"]) == (2, 22_500, None)
        assert row["date"] == datetime(2018, 3, 25, 5, 12, 50, tzinfo=timezone.utc)

    def test_ignores_red_flag_waits_in_the_pit_lane(self):
        laps = [lap("HAM", 5, 1.0, pit_in=pd.Timedelta(seconds=400)), lap("HAM", 6, 1.0, pit_out=pd.Timedelta(seconds=1600))]
        assert pit_stop_rows(laps, race_id=7, session_type="race") == []


class TestRaceControlRows:
    def test_maps_fastf1_messages_and_drops_duplicates(self):
        msg = {"Time": pd.Timestamp("2018-03-25 05:13:19"), "Category": "Flag", "Message": "GREEN LIGHT",
               "Flag": "GREEN", "Scope": "Track", "Sector": float("nan"), "RacingNumber": None, "Lap": 1}
        penalty = {**msg, "Category": "Other", "Message": "CAR 44 PENALTY", "Flag": None, "Scope": None, "RacingNumber": "44"}
        rows = race_control_rows([msg, msg, penalty], race_id=7, session_type="race")
        assert len(rows) == 2
        assert rows[0]["date"] == datetime(2018, 3, 25, 5, 13, 19, tzinfo=timezone.utc)
        assert (rows[0]["flag"], rows[0]["sector"], rows[1]["driver_number"]) == ("GREEN", None, 44)


class TestTelemetryInputs:
    def test_reshapes_fastf1_samples_for_the_shared_lap_builder(self):
        start = pd.Timestamp("2018-03-24 06:00:00")
        car = [{"Date": start + pd.Timedelta(seconds=t), "Speed": 200.0, "Throttle": 100.0, "Brake": False, "nGear": 7}
               for t in range(0, 81)]
        pos = [{"Date": start + pd.Timedelta(seconds=t), "X": float(t * 10), "Y": 0.0} for t in range(0, 81)]
        car_data, location, window = telemetry_inputs(car, pos, 12, start, pd.Timedelta(seconds=80))
        assert (window.lap_number, window.lap_ms) == (12, 80_000)
        telemetry = build_lap_telemetry(car_data, location, window, track_length_m=4_000)
        assert telemetry.distance_m[-1] == 4_000
        assert set(telemetry.speed) == {200}


class TestMsToInt:
    def test_converts_timedelta_to_milliseconds(self):
        assert ms_to_int(pd.Timedelta(seconds=80)) == 80000

    def test_converts_timedelta_string_to_milliseconds(self):
        assert ms_to_int("0 days 00:01:20.123000") == 80123

    def test_nat_returns_none(self):
        assert ms_to_int(pd.NaT) is None

    def test_none_returns_none(self):
        assert ms_to_int(None) is None

    def test_nan_returns_none(self):
        assert ms_to_int(float("nan")) is None

    def test_unparseable_value_returns_none(self):
        assert ms_to_int("not-a-time") is None

    def test_zero_timedelta_returns_zero(self):
        assert ms_to_int(pd.Timedelta(0)) == 0


class TestSessionToLapRecords:
    def test_keeps_every_timed_lap_including_pit_laps(self):
        import pandas as pd


        class _Session:
            laps = pd.DataFrame({
                "Driver": ["VER", "VER", "LEC", "LEC"],
                "LapNumber": [1.0, 2.0, 1.0, 2.0],
                "Position": [1.0, 1.0, 2.0, float("nan")],
                "Time": pd.to_timedelta([95.2, 182.0, 96.0, 183.5], unit="s"),
                "PitInTime": [pd.NaT, pd.to_timedelta(181.0, unit="s"), pd.NaT, pd.NaT],
            })

        records = lap_records(_Session())

        assert records == [
            {"driver": "VER", "lap": 1, "position": 1, "time_ms": 95_200},
            {"driver": "VER", "lap": 2, "position": 1, "time_ms": 182_000},
            {"driver": "LEC", "lap": 1, "position": 2, "time_ms": 96_000},
        ]


class TestSessionWeatherTrace:
    def test_skips_incomplete_weather_samples(self):
        import pandas as pd


        class _Session:
            weather_data = pd.DataFrame({
                "Time": pd.to_timedelta([0, 60, 120], unit="s"),
                "AirTemp": [25.0, float("nan"), 24.0],
                "TrackTemp": [40.0, 39.0, 38.0],
                "Rainfall": [False, False, True],
            })

        trace = session_weather_trace(_Session())

        assert trace.minute_offsets == [0, 2]
        assert trace.air_temp_tenths == [250, 240]
