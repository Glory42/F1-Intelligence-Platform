from src.utils.race_story import Battle, LapTrace, build_lap_traces, find_battles


def _lap(driver, lap, position, time_ms):
    return {"driver": driver, "lap": lap, "position": position, "time_ms": time_ms}


# Hand-worked race: B passes A on lap 3; C runs a lonely third. time_ms = session time at lap end.
WORKED_RACE = [
    _lap("A", 1, 1, 100_000), _lap("B", 1, 2, 101_500), _lap("C", 1, 3, 103_000),
    _lap("A", 2, 1, 190_000), _lap("B", 2, 2, 190_800), _lap("C", 2, 3, 196_000),
    _lap("B", 3, 1, 280_000), _lap("A", 3, 2, 280_400), _lap("C", 3, 3, 289_000),
    _lap("B", 4, 1, 370_000), _lap("A", 4, 2, 370_900), _lap("C", 4, 3, 382_000),
]


class TestBuildLapTraces:
    def test_gap_to_leader_is_measured_against_whoever_leads_each_lap(self):
        traces = build_lap_traces(WORKED_RACE)

        assert traces["A"].gaps_ms == [0, 0, 400, 900]
        assert traces["B"].gaps_ms == [1_500, 800, 0, 0]
        assert traces["C"].gaps_ms == [3_000, 6_000, 9_000, 12_000]

    def test_interval_is_the_gap_to_the_car_directly_ahead(self):
        traces = build_lap_traces(WORKED_RACE)

        assert traces["A"].intervals_ms == [None, None, 400, 900]
        assert traces["B"].intervals_ms == [1_500, 800, None, None]
        assert traces["C"].intervals_ms == [1_500, 5_200, 8_600, 11_100]

    def test_a_lapped_car_has_no_gap_and_counts_laps_down(self):
        # D finishes its 3rd lap at 375 s — after leader B already completed lap 4 at 370 s.
        race = WORKED_RACE + [
            _lap("D", 1, 4, 120_000), _lap("D", 2, 4, 245_000), _lap("D", 3, 4, 375_000),
        ]

        traces = build_lap_traces(race)

        assert traces["D"].gaps_ms == [20_000, 55_000, None]
        assert traces["D"].laps_down == [0, 0, 1]
        assert traces["C"].laps_down == [0, 0, 0, 0]

    def test_records_the_position_held_at_the_end_of_each_lap(self):
        traces = build_lap_traces(WORKED_RACE)

        assert traces["A"].positions == [1, 1, 2, 2]
        assert traces["B"].positions == [2, 2, 1, 1]


def _trace(positions, intervals):
    return LapTrace(positions=positions, gaps_ms=[0] * len(positions), intervals_ms=intervals,
                    laps_down=[0] * len(positions))


class TestFindBattles:
    def test_three_laps_within_a_second_of_the_same_car_is_a_battle(self):
        traces = {
            "Y": _trace([1, 1, 1, 1], [None, None, None, None]),
            "X": _trace([2, 2, 2, 2], [800, 900, 700, 1_400]),
        }

        assert find_battles(traces) == [Battle(chaser="X", leader="Y", lap_start=1, lap_end=3, min_gap_ms=700)]

    def test_a_two_lap_spell_is_not_a_battle(self):
        traces = {
            "Y": _trace([1, 1, 1, 1, 1], [None] * 5),
            "X": _trace([2, 2, 2, 2, 2], [800, 900, 1_500, 800, 900]),
        }

        assert find_battles(traces) == []


class TestWeatherTrace:
    def test_samples_temperatures_in_tenths_and_rain_per_minute_from_the_session_start(self):
        import pandas as pd

        from src.utils.race_story import weather_trace

        frame = pd.DataFrame({
            "Time": pd.to_timedelta([3_600, 3_660, 3_720], unit="s"),
            "AirTemp": [25.0, 25.3, 24.9],
            "TrackTemp": [41.2, 40.0, 37.5],
            "Rainfall": [False, True, True],
        })

        trace = weather_trace(frame)

        assert trace.minute_offsets == [0, 1, 2]
        assert trace.air_temp_tenths == [250, 253, 249]
        assert trace.track_temp_tenths == [412, 400, 375]
        assert trace.rainfall == [False, True, True]
