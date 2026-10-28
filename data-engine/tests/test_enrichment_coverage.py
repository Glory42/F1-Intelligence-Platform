from datetime import datetime, timezone

import pytest

from src import enrichment_coverage as ec
from src.enrichment_coverage import Source
from src.jobs import ingest_stints
from src.utils.driver_registry import SeasonDrivers
from src.utils.fastf1_session import stints as fastf1_stints
from src.utils.openf1_session import OpenF1Session, stints as openf1_stints
from tests.support.fake_db import FakeConnection


class TestSourceFor:
    @pytest.mark.parametrize("year, source", [
        (2017, None), (2018, Source.FASTF1), (2022, Source.FASTF1), (2023, Source.OPENF1), (2026, Source.OPENF1),
    ])
    def test_fastf1_fills_2018_to_2022_and_openf1_everything_since(self, year, source):
        assert ec.source_for(year) is source


_SPRINT_DAY = datetime(2026, 3, 7, 15, 0, tzinfo=timezone.utc)


def _row(status="completed", sprint_date=None, **gaps):
    """A weekend with every coverage present except the jobs passed as False."""
    return {"id": 1, "status": status, "sprint_date": sprint_date,
            **{c.flag: True for c in ec.COVERAGES}, **gaps}


def _missing(row):
    return [c.job for c in ec.missing(row)]


class TestMissing:
    def test_nothing_when_everything_is_covered(self):
        assert _missing(_row()) == []

    def test_only_the_job_whose_table_is_empty(self):
        assert _missing(_row(ingest_pit_stops=False)) == ["ingest_pit_stops"]

    def test_race_events_wait_for_the_race_but_qualifying_telemetry_does_not(self):
        row = _row(status="qualifying_done", ingest_race_control=False, ingest_qualifying_telemetry=False)
        assert _missing(row) == ["ingest_qualifying_telemetry"]

    def test_sprint_sessions_count_only_on_a_sprint_weekend(self):
        gaps = {"ingest_stints_sprint": False, "ingest_qualifying_telemetry_sprint": False}
        assert _missing(_row(**gaps)) == []
        assert _missing(_row(sprint_date=_SPRINT_DAY, **gaps)) == [
            "ingest_qualifying_telemetry_sprint", "ingest_stints_sprint",
        ]

    def test_stale_standings_missing_odds_and_story_after_the_race(self):
        row = _row(compute_season_stats=False, compute_title_odds=False, ingest_race_story=False)
        assert _missing(row) == ["ingest_race_story", "compute_season_stats", "compute_title_odds"]

    def test_a_flag_absent_from_the_row_counts_as_covered(self):
        assert _missing({"id": 1, "status": "completed", "sprint_date": None, "ingest_overtakes": False}) == [
            "ingest_overtakes",
        ]

    def test_team_radio_is_never_checked(self):
        # F1 often publishes no radio, so an empty table says nothing.
        assert not any(c.table == "team_radio_clips" for c in ec.COVERAGES)


class TestStintCompounds:
    @pytest.mark.parametrize("raw, stored", [
        ("MEDIUM", "MEDIUM"), ("soft", "SOFT"), ("HYPERSOFT", "HYPERSOFT"),
        ("UNKNOWN", None), ("TEST_UNKNOWN", None), ("nan", None), (None, None),
    ])
    def test_openf1_and_fastf1_stints_store_the_same_compound(self, raw, stored):
        drivers = SeasonDrivers(by_number={44: 1}, by_code={"HAM": 1})
        [from_openf1] = openf1_stints(OpenF1Session(session_key=1, stints=[
            {"driver_number": 44, "stint_number": 1, "compound": raw, "lap_start": 1, "lap_end": 9, "tyre_age_at_start": 0},
        ]))
        [from_fastf1] = fastf1_stints([{"Driver": "HAM", "LapNumber": 1, "Stint": 1.0, "Compound": raw, "TyreLife": 1}])

        rows, _ = ingest_stints.CONFIG.to_rows([from_openf1, from_fastf1], drivers, 7, "race")

        assert rows[0]["compound"] == rows[1]["compound"] == stored
        assert rows[0]["driver_id"] == rows[1]["driver_id"] == 1


class TestCoverageOf:
    def test_finds_the_table_a_session_step_fills(self):
        coverage = ec.coverage_of("ingest_pit_stops_sprint")
        assert (coverage.table, coverage.session_type) == ("race_pit_stops", "sprint")
        assert ec.CONFLICT_KEYS[coverage.table] == ["race_id", "session_type", "driver_id", "lap_number"]


class TestBackfillAllowed:
    def test_a_backfill_writes_while_storage_is_under_half_the_free_tier(self):
        assert ec.backfill_allowed(FakeConnection([{"db_bytes": 400_000_000}])) is True

    def test_a_backfill_stops_at_half_the_free_tier(self, capsys):
        assert ec.backfill_allowed(FakeConnection([{"db_bytes": 500_000_000}])) is False
        assert "[STOP]" in capsys.readouterr().out


class TestReadCoverage:
    def test_one_query_selects_every_flag_for_one_round(self):
        row = _row()
        conn = FakeConnection([[row]])

        assert ec.read_coverage(conn, 2026, 2026, round_number=5) == [row]

        sql, params = conn.cursors[0].executed[0]
        assert params == (2026, 2026, 5, 5)
        for c in ec.COVERAGES:
            assert f"{c.present_sql} AS {c.flag}" in sql

    def test_a_season_range_reads_every_round_in_order(self):
        conn = FakeConnection([[]])
        ec.read_coverage(conn, 2018, 2022)
        sql, params = conn.cursors[0].executed[0]
        assert params == (2018, 2022, None, None)
        assert "ORDER BY s.year, r.round_number" in sql
