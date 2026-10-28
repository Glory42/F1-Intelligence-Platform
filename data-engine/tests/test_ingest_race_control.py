from src.jobs.ingest_race_control import CONFIG
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session


def _to_rows(raw, race_id, driver_map):
    """Raw OpenF1 rows through the adapter and the job's row mapping, as run_openf1_job runs them."""
    records = CONFIG.records(OpenF1Session(session_key=1, **{CONFIG.part: raw}))
    return CONFIG.to_rows(records, SeasonDrivers(by_number=driver_map, by_code={}), race_id, "race")


class TestToRows:
    def test_maps_a_message_to_a_row(self):
        messages = [{
            "date": "2024-11-03T15:31:01+00:00", "category": "Flag", "flag": "YELLOW",
            "lap_number": 12, "driver_number": 44, "scope": "Sector", "sector": 4,
            "message": "YELLOW IN TRACK SECTOR 4",
        }]

        rows, skipped = _to_rows(messages, race_id=1, driver_map={})

        assert skipped == 0
        assert rows == [{
            "race_id": 1, "session_type": "race", "date": "2024-11-03T15:31:01+00:00", "category": "Flag",
            "flag": "YELLOW", "lap_number": 12, "driver_number": 44,
            "scope": "Sector", "sector": 4, "message": "YELLOW IN TRACK SECTOR 4",
        }]

    def test_missing_optional_fields_map_to_none(self):
        messages = [{"date": "2024-11-03T15:31:01+00:00", "category": "Other", "message": "PIT EXIT CLOSED"}]

        rows, skipped = _to_rows(messages, race_id=1, driver_map={})

        assert skipped == 0
        row = rows[0]
        assert row["flag"] is None
        assert row["lap_number"] is None
        assert row["driver_number"] is None
        assert row["scope"] is None
        assert row["sector"] is None

    def test_empty_input_returns_empty(self):
        assert _to_rows([], race_id=1, driver_map={}) == ([], 0)
