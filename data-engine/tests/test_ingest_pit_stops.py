from src.jobs.ingest_pit_stops import CONFIG
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session
from tests.support.openf1_fixtures import load_openf1_fixture

VERSTAPPEN, NORRIS, LECLERC = 1, 4, 16


def _to_rows(raw, race_id, driver_map):
    """Raw OpenF1 rows through the adapter and the job's row mapping, as run_openf1_job runs them."""
    records = CONFIG.records(OpenF1Session(session_key=1, **{CONFIG.part: raw}))
    return CONFIG.to_rows(records, SeasonDrivers(by_number=driver_map, by_code={}), race_id, "race")


class TestToRows:
    def test_maps_monza_2025_stops_with_stationary_times_in_ms(self):
        raw = load_openf1_fixture("pit_2025_monza_race")

        rows, skipped = _to_rows(raw, race_id=9, driver_map={VERSTAPPEN: 10, NORRIS: 40})

        assert skipped == 0
        assert rows == [
            {"race_id": 9, "session_type": "race", "driver_id": 10, "lap_number": 37, "pit_lane_ms": 24545, "stationary_ms": 2300,
             "date": "2025-09-07T13:55:17.647000+00:00"},
            {"race_id": 9, "session_type": "race", "driver_id": 40, "lap_number": 46, "pit_lane_ms": 27498, "stationary_ms": 5900,
             "date": "2025-09-07T14:07:50.629000+00:00"},
        ]

    def test_stops_before_the_2024_us_gp_have_no_stationary_time(self):
        raw = [p for p in load_openf1_fixture("pit_2024_monza_race") if p["driver_number"] == LECLERC]

        rows, _ = _to_rows(raw, race_id=7, driver_map={LECLERC: 160})

        assert [(r["lap_number"], r["pit_lane_ms"], r["stationary_ms"]) for r in rows] == [(15, 24500, None)]

    def test_skips_stops_of_unknown_driver_numbers(self):
        raw = load_openf1_fixture("pit_2025_monza_race")

        rows, skipped = _to_rows(raw, race_id=9, driver_map={NORRIS: 40})

        assert [r["driver_id"] for r in rows] == [40]
        assert skipped == 1
