"""Covers data_quality_repair.run: picking the audit run to act on, grouping fixable issues by
race, running weekend_pipeline.repair_plan for each race, and the resolve bookkeeping. The
pipeline's job table and get_conn are mocked; FakeConnection scripts the queries in order:
  1. audit-run lookup (latest for year, or WHERE id=%s when resolve_run given)
  2. fixable-issues lookup
  (+ one round lookup per race whose issues lack round_number)
  (+ one UPDATE ... SET resolved=true per issue actually fixed)
"""
from unittest.mock import patch

from src import weekend_pipeline as wp
from src.jobs import data_quality_repair as repair
from tests.support.fake_db import FakeConnection


def _issue(**over):
    base = dict(
        id=1, race_id=10, round_number=5, year=2024,
        table_name="race_predictions", check_name="prediction_present",
        severity="high", detail="", fixable=True, is_sprint=False,
    )
    base.update(over)
    return base


def _run(monkeypatch, queued, *, year=2024, resolve_run=None, fail=()):
    calls: list[tuple[str, wp.RaceRunContext]] = []

    def job(name):
        def run(ctx):
            calls.append((name, ctx))
            if name in fail:
                raise RuntimeError("boom")
        return run

    for name in wp.JOBS:
        monkeypatch.setitem(wp.JOBS, name, job(name))
    conn = FakeConnection(list(queued))
    with patch.object(repair, "get_conn", return_value=conn):
        repair.run(year=year, resolve_run=resolve_run)
    return conn, calls


def _resolved(conn):
    return [params for cur in conn.cursors for sql, params in cur.executed if "SET resolved=true" in sql]


class TestRunSelection:
    def test_no_audit_run_for_year_exits_without_touching_jobs(self, monkeypatch):
        conn, calls = _run(monkeypatch, [None])
        assert calls == []
        assert conn.closed is True

    def test_no_fixable_issues_exits_early(self, monkeypatch):
        _, calls = _run(monkeypatch, [{"id": 7}, []])
        assert calls == []

    def test_explicit_resolve_run_queries_by_id(self, monkeypatch):
        conn, _ = _run(monkeypatch, [{"id": 99}, []], resolve_run=99)
        first_sql, first_params = conn.cursors[0].executed[0]
        assert "WHERE id=%s" in first_sql
        assert first_params == (99,)

    def test_default_selects_latest_run_for_year(self, monkeypatch):
        conn, _ = _run(monkeypatch, [{"id": 3}, []])
        first_sql, first_params = conn.cursors[0].executed[0]
        assert "ORDER BY generated_at DESC" in first_sql
        assert first_params == (2024,)


class TestRepairExecution:
    def test_single_issue_runs_its_repair_plan_for_its_race_and_marks_it_resolved(self, monkeypatch):
        conn, calls = _run(monkeypatch, [{"id": 1}, [_issue()], []])
        assert [name for name, _ in calls] == ["compute_features", "compute_title_odds", "ingest_qualifying_telemetry"]
        assert {ctx for _, ctx in calls} == {wp.RaceRunContext(race_id=10, year=2024, round_number=5)}
        assert _resolved(conn) == [(1,)]
        assert conn.commits == 1

    def test_a_race_results_repair_runs_what_the_worker_runs_after_the_race(self, monkeypatch):
        _, calls = _run(monkeypatch, [{"id": 1}, [_issue(table_name="race_results", check_name="row_count")], []])
        names = [name for name, _ in calls]
        assert names[:3] == ["ingest_race", "compute_season_stats", "compute_title_odds"]
        assert "ingest_race_control" in names and "ingest_pit_stops_sprint" in names

    def test_issues_on_the_same_race_share_one_pass(self, monkeypatch):
        issues = [
            _issue(id=1, table_name="lap_times", check_name="lap_coverage"),
            _issue(id=2, table_name="race_results", check_name="row_count"),
        ]
        conn, calls = _run(monkeypatch, [{"id": 1}, issues, [], []])
        names = [name for name, _ in calls]
        assert names.count("ingest_race") == 1
        assert _resolved(conn) == [(1,), (2,)]

    def test_distinct_races_are_repaired_independently(self, monkeypatch):
        issues = [
            _issue(id=1, race_id=10, round_number=5),
            _issue(id=2, race_id=11, round_number=6),
        ]
        conn, calls = _run(monkeypatch, [{"id": 1}, issues, [], []])
        assert [ctx.race_id for name, ctx in calls if name == "compute_features"] == [10, 11]
        assert conn.commits == 2

    def test_issue_with_no_repair_path_is_skipped(self, monkeypatch):
        issue = _issue(table_name="fp2_long_run_times", check_name="driver_coverage")
        conn, calls = _run(monkeypatch, [{"id": 1}, [issue]])
        assert calls == []
        assert conn.commits == 0

    def test_round_number_is_resolved_from_race_id_when_absent(self, monkeypatch):
        issue = _issue(round_number=None, table_name="race_results", check_name="row_count")
        _, calls = _run(monkeypatch, [{"id": 1}, [issue], {"round_number": 8}, []])
        assert calls[0] == ("ingest_race", wp.RaceRunContext(race_id=10, year=2024, round_number=8))

    def test_step_failure_leaves_the_issue_unresolved(self, monkeypatch):
        conn, _ = _run(monkeypatch, [{"id": 1}, [_issue(id=1)]], fail={"compute_features"})
        assert _resolved(conn) == []
        assert conn.commits == 0
