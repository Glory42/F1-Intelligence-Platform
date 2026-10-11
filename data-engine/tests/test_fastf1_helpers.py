import pandas as pd

from src.utils.fastf1_helpers import ms_to_int


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

        from src.utils.fastf1_helpers import session_to_lap_records

        class _Session:
            laps = pd.DataFrame({
                "Driver": ["VER", "VER", "LEC", "LEC"],
                "LapNumber": [1.0, 2.0, 1.0, 2.0],
                "Position": [1.0, 1.0, 2.0, float("nan")],
                "Time": pd.to_timedelta([95.2, 182.0, 96.0, 183.5], unit="s"),
                "PitInTime": [pd.NaT, pd.to_timedelta(181.0, unit="s"), pd.NaT, pd.NaT],
            })

        records = session_to_lap_records(_Session())

        assert records == [
            {"driver": "VER", "lap": 1, "position": 1, "time_ms": 95_200},
            {"driver": "VER", "lap": 2, "position": 1, "time_ms": 182_000},
            {"driver": "LEC", "lap": 1, "position": 2, "time_ms": 96_000},
        ]


class TestSessionWeatherTrace:
    def test_skips_incomplete_weather_samples(self):
        import pandas as pd

        from src.utils.fastf1_helpers import session_weather_trace

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
