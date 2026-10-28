from src.jobs.ingest_team_radio import CONFIG
from src.utils.driver_registry import SeasonDrivers
from src.utils.openf1_session import OpenF1Session


def _to_rows(raw, race_id, driver_map):
    """Raw OpenF1 rows through the adapter and the job's row mapping, as run_openf1_job runs them."""
    records = CONFIG.records(OpenF1Session(session_key=1, **{CONFIG.part: raw}))
    return CONFIG.to_rows(records, SeasonDrivers(by_number=driver_map, by_code={}), race_id, "race")


class TestToRows:
    def test_maps_a_clip_to_a_row(self):
        clips = [{
            "date": "2024-11-03T14:45:52+00:00", "driver_number": 4,
            "recording_url": "https://livetiming.formula1.com/static/clip.mp3",
        }]

        rows, skipped = _to_rows(clips, race_id=1, driver_map={4: 100})

        assert skipped == 0
        assert rows == [{
            "race_id": 1, "session_type": "race", "driver_id": 100, "date": "2024-11-03T14:45:52+00:00",
            "recording_url": "https://livetiming.formula1.com/static/clip.mp3",
        }]

    def test_skips_clips_with_unknown_driver_number(self):
        clips = [{"date": "d", "driver_number": 99, "recording_url": "u"}]

        rows, skipped = _to_rows(clips, race_id=1, driver_map={4: 100})

        assert rows == []
        assert skipped == 1

    def test_empty_input_returns_empty(self):
        assert _to_rows([], race_id=1, driver_map={}) == ([], 0)
