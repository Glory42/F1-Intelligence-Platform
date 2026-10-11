from datetime import datetime, timedelta, timezone

from src.utils.telemetry import LapWindow, build_lap_telemetry, fastest_laps
from tests.support.openf1_fixtures import load_openf1_fixture

NORRIS, PIASTRI = 4, 81


class TestFastestLaps:
    def test_picks_each_drivers_quickest_timed_lap(self):
        laps = load_openf1_fixture("laps_2024_monza_qualifying")

        best = fastest_laps(laps)

        # Official 2024 Italian GP qualifying: NOR pole 1:19.327, PIA P2 1:19.436.
        assert (best[NORRIS].lap_number, best[NORRIS].lap_ms) == (11, 79_327)
        assert (best[PIASTRI].lap_number, best[PIASTRI].lap_ms) == (15, 79_436)

    def test_skips_a_timed_lap_that_has_no_start_date(self):
        laps = [
            {"driver_number": 1, "lap_number": 3, "lap_duration": 70.0, "is_pit_out_lap": False, "date_start": None},
            {"driver_number": 1, "lap_number": 4, "lap_duration": 71.0, "is_pit_out_lap": False,
             "date_start": "2023-10-07T18:00:00+00:00"},
        ]
        assert fastest_laps(laps)[1].lap_number == 4


T0 = datetime(2024, 8, 31, 15, 0, tzinfo=timezone.utc)


def _iso(seconds: float) -> str:
    return (T0 + timedelta(seconds=seconds)).isoformat()


class TestBuildLapTelemetry:
    def test_constant_180kmh_covers_500m_in_10s_on_the_distance_grid(self):
        car = [{"date": _iso(t), "speed": 180, "throttle": 100, "brake": 0, "n_gear": 7} for t in range(11)]
        loc = [{"date": _iso(t), "x": 50 * t, "y": 0} for t in range(11)]

        lap = build_lap_telemetry(car, loc, LapWindow(1, T0, 10_000), track_length_m=500, step_m=100)

        assert lap.distance_m == [0, 100, 200, 300, 400, 500]
        assert lap.time_ms == [0, 2_000, 4_000, 6_000, 8_000, 10_000]
        assert lap.x == [0, 100, 200, 300, 400, 500]
        assert lap.speed == [180] * 6

    def test_norris_2024_monza_pole_lap_resamples_to_the_official_lap_time(self):
        window = fastest_laps(load_openf1_fixture("laps_2024_monza_qualifying"))[NORRIS]

        lap = build_lap_telemetry(
            load_openf1_fixture("car_data_2024_monza_q_nor_pole"),
            load_openf1_fixture("location_2024_monza_q_nor_pole"),
            window,
            track_length_m=5_793,
        )

        assert len(lap.distance_m) == 580  # 0..5790 m every 10 m
        assert abs(lap.time_ms[-1] - 79_327) < 500
        assert max(lap.speed) == 347

    def test_the_resampled_lap_spans_the_whole_official_lap_time(self):
        # car_data starts ~0.1 s after the line and stops short of it; the trace must still cover
        # the full lap, or two drivers' deltas drift by however their sample timing happened to fall.
        window = fastest_laps(load_openf1_fixture("laps_2024_monza_qualifying"))[NORRIS]

        lap = build_lap_telemetry(
            load_openf1_fixture("car_data_2024_monza_q_nor_pole"),
            load_openf1_fixture("location_2024_monza_q_nor_pole"),
            window,
            track_length_m=5_793,
        )

        assert lap.time_ms[0] == 0
        assert abs(lap.time_ms[-1] - 79_327 * 5_790 / 5_793) < 40

    def test_a_lap_with_too_few_samples_in_its_window_is_rejected(self):
        import pytest

        car = [{"date": _iso(50), "speed": 200, "throttle": 100, "brake": 0, "n_gear": 7}]

        with pytest.raises(ValueError, match="too few"):
            build_lap_telemetry(car, [{"date": _iso(50), "x": 0, "y": 0}], LapWindow(1, T0, 10_000), 500)
