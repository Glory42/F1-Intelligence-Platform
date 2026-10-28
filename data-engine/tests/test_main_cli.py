import sys

import pytest

from src import main


def _cli(monkeypatch, *argv):
    monkeypatch.setattr(sys, "argv", ["src.main", *argv])
    main.main()


@pytest.mark.parametrize("job", ["ingest_stints", "ingest_race_story"])
def test_session_enrichment_jobs_take_the_session_from_the_cli(monkeypatch, job):
    calls = []
    module = __import__(f"src.jobs.{job}", fromlist=["run"])
    monkeypatch.setattr(module, "run", lambda year, round_num, session_name: calls.append((year, round_num, session_name)))

    _cli(monkeypatch, "--job", job, "--year", "2025", "--round", "3", "--session", "Sprint")

    assert calls == [(2025, 3, "Sprint")]


def test_an_auto_detected_sprint_session_job_looks_for_a_completed_weekend(monkeypatch):
    detected = []
    monkeypatch.setattr(main, "auto_detect_round", lambda job, year: detected.append(job) or (2025, 3))
    monkeypatch.setattr(__import__("src.jobs.ingest_race_story", fromlist=["run"]), "run", lambda *a, **k: None)

    _cli(monkeypatch, "--job", "ingest_race_story", "--session", "Sprint")

    assert detected == ["ingest_race_story_sprint"]


def test_a_race_scoped_job_without_race_id_exits_1(monkeypatch, capsys):
    with pytest.raises(SystemExit) as exit_:
        _cli(monkeypatch, "--job", "compute_features")

    assert exit_.value.code == 1
    assert "--race_id required for compute_features" in capsys.readouterr().err


def test_a_season_job_runs_with_the_year(monkeypatch):
    from src.jobs import compute_title_odds

    calls = []
    monkeypatch.setattr(compute_title_odds, "run", calls.append)

    _cli(monkeypatch, "--job", "compute_title_odds", "--year", "2026")

    assert calls == [2026]


def test_qualifying_telemetry_reads_sprint_qualifying_for_the_sprint_session(monkeypatch):
    from src.jobs import ingest_qualifying_telemetry

    calls = []
    monkeypatch.setattr(ingest_qualifying_telemetry, "run", lambda y, r, session_type: calls.append((y, r, session_type)))

    _cli(monkeypatch, "--job", "ingest_qualifying_telemetry", "--year", "2025", "--round", "6", "--session", "Sprint")

    assert calls == [(2025, 6, "SQ")]


def test_every_registered_job_is_a_cli_choice_and_a_pipeline_step():
    from src import weekend_pipeline as wp
    from src.jobs.registry import JOBS, Needs

    assert {j.name for j in JOBS.values() if j.needs is not Needs.NONE} <= set(wp.JOBS)
