from src.jobs.ingest_pit_stops import _to_rows
from tests.support.openf1_fixtures import load_openf1_fixture

VERSTAPPEN, NORRIS, LECLERC = 1, 4, 16


class TestToRows:
    def test_maps_monza_2025_stops_with_stationary_times_in_ms(self):
        raw = load_openf1_fixture("pit_2025_monza_race")

        rows, skipped = _to_rows(raw, race_id=9, driver_map={VERSTAPPEN: 10, NORRIS: 40})

        assert skipped == 0
        assert rows == [
            {"race_id": 9, "driver_id": 10, "lap_number": 37, "pit_lane_ms": 24545, "stationary_ms": 2300,
             "date": "2025-09-07T13:55:17.647000+00:00"},
            {"race_id": 9, "driver_id": 40, "lap_number": 46, "pit_lane_ms": 27498, "stationary_ms": 5900,
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


class TestRun:
    def test_wires_the_race_pit_stops_config(self, monkeypatch):
        import src.jobs.ingest_pit_stops as ingest_pit_stops
        from src.utils.openf1_client import fetch_pit_stops

        captured = {}
        monkeypatch.setattr(
            ingest_pit_stops, "run_openf1_job",
            lambda year, round_num, config, session_name="Race": captured.update(config=config),
        )

        ingest_pit_stops.run(2025, 16)

        config = captured["config"]
        assert config.table == "race_pit_stops"
        assert config.conflict_cols == ["race_id", "session_type", "driver_id", "lap_number"]
        assert config.fetch is fetch_pit_stops
        assert config.to_rows is _to_rows
