"""main.main() tells the API's KV cache that data changed once a job has written to Neon."""
import sys

import pytest

from src import main
from src.jobs.registry import Job, Needs
from tests.support.fake_kv_api import install_fake_kv_api


def _run_cli(monkeypatch, run) -> None:
    monkeypatch.setitem(main.JOBS, "compute_season_stats", Job("compute_season_stats", Needs.YEAR, run))
    monkeypatch.setattr(sys, "argv", ["main", "--job", "compute_season_stats", "--year", "2026"])
    main.main()


def test_a_successful_job_bumps_the_api_cache_version(monkeypatch):
    kv = install_fake_kv_api(monkeypatch)

    _run_cli(monkeypatch, lambda args: None)

    assert "version" in kv.state()


def test_a_failed_job_leaves_the_api_cache_version_alone(monkeypatch):
    kv = install_fake_kv_api(monkeypatch)

    def fail(args):
        raise RuntimeError("Neon refused the write")

    with pytest.raises(SystemExit):
        _run_cli(monkeypatch, fail)

    assert kv.state() == {}
