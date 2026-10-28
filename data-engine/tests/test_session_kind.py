import pytest

from src.session_kind import (
    BY_CODE, BY_NAME, RACE, SPRINT, ResultsIngest, Source, is_sprint_weekend, results_ingest_for, source_for,
)


class TestSprintWeekend:
    @pytest.mark.parametrize("event_format", ["sprint", "sprint_qualifying", "sprint_shootout"])
    def test_every_years_sprint_format_is_a_sprint_weekend(self, event_format):
        assert is_sprint_weekend(event_format)

    @pytest.mark.parametrize("event_format", ["conventional", None])
    def test_anything_else_is_not(self, event_format):
        assert not is_sprint_weekend(event_format)


class TestRaceSessions:
    def test_the_cli_name_and_the_adapter_code_find_the_same_session(self):
        assert BY_NAME["Race"] is BY_CODE["R"] is RACE
        assert BY_NAME["Sprint"] is BY_CODE["S"] is SPRINT
        assert (SPRINT.tag, SPRINT.key_column) == ("sprint", "openf1_sprint_session_key")


class TestSourceFor:
    @pytest.mark.parametrize("year, source", [
        (2017, None), (2018, Source.FASTF1), (2022, Source.FASTF1), (2023, Source.OPENF1), (2026, Source.OPENF1),
    ])
    def test_fastf1_fills_2018_to_2022_and_openf1_everything_since(self, year, source):
        assert source_for(year) is source


class TestResultsIngestFor:
    @pytest.mark.parametrize("year, ingest", [
        (1990, ResultsIngest.LEGACY), (2017, ResultsIngest.LEGACY),
        (2018, None), (2022, None),
        (2023, ResultsIngest.LIVE), (2026, ResultsIngest.LIVE),
    ])
    def test_2018_to_2022_cannot_be_reingested(self, year, ingest):
        assert results_ingest_for(year) is ingest
