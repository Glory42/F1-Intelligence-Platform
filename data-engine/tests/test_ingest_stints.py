from src.jobs.ingest_stints import CONFIG
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session
from tests.support.openf1_fixtures import load_openf1_fixture

LECLERC, PIASTRI = 16, 81


def _to_rows(raw, race_id, driver_map):
    """Raw OpenF1 rows through the adapter and the job's row mapping, as run_openf1_job runs them."""
    records = CONFIG.records(OpenF1Session(session_key=1, **{CONFIG.part: raw}))
    return CONFIG.to_rows(records, SeasonDrivers(by_number=driver_map, by_code={}), race_id, "race")


class TestToRows:
    def test_maps_leclercs_one_stop_monza_2024_strategy(self):
        raw = [s for s in load_openf1_fixture("stints_2024_monza_race") if s["driver_number"] == LECLERC]

        rows, skipped = _to_rows(raw, race_id=7, driver_map={LECLERC: 160})

        assert skipped == 0
        assert rows == [
            {"race_id": 7, "session_type": "race", "driver_id": 160, "stint_number": 1, "compound": "MEDIUM",
             "lap_start": 1, "lap_end": 15, "tyre_age_at_start": 0},
            {"race_id": 7, "session_type": "race", "driver_id": 160, "stint_number": 2, "compound": "HARD",
             "lap_start": 16, "lap_end": 53, "tyre_age_at_start": 0},
        ]

    def test_skips_stints_of_unknown_driver_numbers(self):
        raw = load_openf1_fixture("stints_2024_monza_race")

        rows, skipped = _to_rows(raw, race_id=7, driver_map={LECLERC: 160})

        assert {r["driver_id"] for r in rows} == {160}
        assert skipped == 3  # Piastri's three stints in the recorded payload
