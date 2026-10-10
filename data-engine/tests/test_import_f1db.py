import json

import src.jobs.import_f1db as job
from src.utils.storage_guard import StorageTier
from tests.support.f1db_fixtures import load_f1db_fixture
from tests.support.fake_db import FakeConnection


def _release_dir(tmp_path):
    files = {
        "f1db-drivers.json": load_f1db_fixture("drivers"),
        "f1db-constructors.json": load_f1db_fixture("constructors"),
        "f1db-races-race-results.json": load_f1db_fixture("race_results_verstappen_2015_2019"),
        "f1db-races.json": load_f1db_fixture("races_verstappen_2015_2019"),
        "f1db-seasons-entrants-chassis.json": load_f1db_fixture("entrants_chassis_red_bull"),
        "f1db-seasons-entrants-engines.json": load_f1db_fixture("entrants_engines_red_bull"),
        "f1db-constructors-chronology.json": load_f1db_fixture("constructors_chronology"),
        "f1db-chassis.json": [{"id": "red-bull-rb22", "name": "RB22"}],
        "f1db-engine-manufacturers.json": [{"id": "red-bull-ford", "name": "Red Bull Ford"}],
    }
    for name, data in files.items():
        (tmp_path / name).write_text(json.dumps(data))
    return tmp_path


def _patch(monkeypatch, already_imported):
    conn = FakeConnection([{"id": 1} if already_imported else None])
    monkeypatch.setattr(job, "get_conn", lambda: conn)
    monkeypatch.setattr(job, "read_storage_tier", lambda conn: StorageTier.ALLOW_ALL)
    writes = {}
    monkeypatch.setattr(job, "upsert", lambda conn, table, rows, conflict: writes.update({table: rows}))
    return conn, writes


class TestRun:
    def test_imports_drivers_with_milestones_constructors_and_lineage(self, tmp_path, monkeypatch):
        conn, writes = _patch(monkeypatch, already_imported=False)

        job.run(str(_release_dir(tmp_path)), "v2026.16.1")

        verstappen = next(r for r in writes["history_drivers"] if r["f1db_id"] == "max-verstappen")
        assert (verstappen["race_wins"], verstappen["first_win_date"]) == (72, "2016-05-15")
        assert {r["f1db_id"] for r in writes["history_constructors"]} == {"ferrari", "red-bull"}
        assert ("red-bull", 2026, "RB22", "Red Bull Ford") in [
            (r["constructor_f1db_id"], r["year"], r["chassis"], r["engine"]) for r in writes["history_constructor_seasons"]
        ]
        executed = [params for cur in conn.cursors for _, params in cur.executed]
        assert ("v2026.16.1",) in executed  # recorded so the same release is never imported twice
        assert conn.commits == 1

    def test_skips_a_release_that_was_already_imported(self, tmp_path, monkeypatch):
        conn, writes = _patch(monkeypatch, already_imported=True)

        job.run(str(_release_dir(tmp_path)), "v2026.16.1")

        assert writes == {}
        assert conn.commits == 0
