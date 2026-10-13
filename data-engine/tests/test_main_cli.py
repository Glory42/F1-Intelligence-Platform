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
