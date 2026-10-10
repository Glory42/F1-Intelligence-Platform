from src.jobs.ingest_stints import _to_rows
from tests.support.openf1_fixtures import load_openf1_fixture

LECLERC, PIASTRI = 16, 81


class TestToRows:
    def test_maps_leclercs_one_stop_monza_2024_strategy(self):
        raw = [s for s in load_openf1_fixture("stints_2024_monza_race") if s["driver_number"] == LECLERC]

        rows, skipped = _to_rows(raw, race_id=7, driver_map={LECLERC: 160})

        assert skipped == 0
        assert rows == [
            {"race_id": 7, "driver_id": 160, "stint_number": 1, "compound": "MEDIUM",
             "lap_start": 1, "lap_end": 15, "tyre_age_at_start": 0},
            {"race_id": 7, "driver_id": 160, "stint_number": 2, "compound": "HARD",
             "lap_start": 16, "lap_end": 53, "tyre_age_at_start": 0},
        ]

    def test_skips_stints_of_unknown_driver_numbers(self):
        raw = load_openf1_fixture("stints_2024_monza_race")

        rows, skipped = _to_rows(raw, race_id=7, driver_map={LECLERC: 160})

        assert {r["driver_id"] for r in rows} == {160}
        assert skipped == 3  # Piastri's three stints in the recorded payload


class TestRun:
    def test_wires_the_race_stints_config(self, monkeypatch):
        import src.jobs.ingest_stints as ingest_stints
        from src.utils.openf1_client import fetch_stints

        captured = {}
        monkeypatch.setattr(
            ingest_stints, "run_openf1_job",
            lambda year, round_num, config, session_name="Race": captured.update(config=config, session_name=session_name),
        )

        ingest_stints.run(2024, 16, session_name="Sprint")

        config = captured["config"]
        assert captured["session_name"] == "Sprint"
        assert config.table == "race_stints"
        assert config.conflict_cols == ["race_id", "session_type", "driver_id", "stint_number"]
        assert config.fetch is fetch_stints
        assert config.to_rows is _to_rows
