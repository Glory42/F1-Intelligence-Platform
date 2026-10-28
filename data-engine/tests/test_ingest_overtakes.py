from src.jobs.ingest_overtakes import CONFIG
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session


def _to_rows(raw, race_id, driver_map):
    """Raw OpenF1 rows through the adapter and the job's row mapping, as run_openf1_job runs them."""
    records = CONFIG.records(OpenF1Session(session_key=1, **{CONFIG.part: raw}))
    return CONFIG.to_rows(records, SeasonDrivers(by_number=driver_map, by_code={}), race_id, "race")


class TestToRows:
    def test_maps_an_overtake_to_a_row(self):
        overtakes = [{
            "date": "2024-11-03T15:50:07+00:00",
            "overtaking_driver_number": 63, "overtaken_driver_number": 4, "position": 1,
        }]

        rows, skipped = _to_rows(overtakes, race_id=1, driver_map={63: 100, 4: 101})

        assert skipped == 0
        assert rows == [{
            "race_id": 1, "session_type": "race", "date": "2024-11-03T15:50:07+00:00",
            "overtaking_driver_id": 100, "overtaken_driver_id": 101, "position": 1,
        }]

    def test_skips_rows_with_unknown_overtaking_driver_number(self):
        overtakes = [{"date": "d", "overtaking_driver_number": 99, "overtaken_driver_number": 4, "position": 1}]

        rows, skipped = _to_rows(overtakes, race_id=1, driver_map={4: 101})

        assert rows == []
        assert skipped == 1

    def test_skips_rows_with_unknown_overtaken_driver_number(self):
        overtakes = [{"date": "d", "overtaking_driver_number": 63, "overtaken_driver_number": 99, "position": 1}]

        rows, skipped = _to_rows(overtakes, race_id=1, driver_map={63: 100})

        assert rows == []
        assert skipped == 1

    def test_empty_input_returns_empty(self):
        assert _to_rows([], race_id=1, driver_map={}) == ([], 0)
