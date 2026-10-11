"""Covers data_quality_repair.run: picking the audit run to act on, grouping fixable
issues by race, de-duplicating repair steps across issues, and the per-group
resolve/rollback bookkeeping. The ingest/recompute jobs and get_conn are mocked;
FakeConnection scripts the SELECTs run() makes in order:
  1. audit-run lookup (latest for year, or WHERE id=%s when resolve_run given)
  2. fixable-issues lookup
  (+ one row lookup per _run_ingest call that must resolve round_number from race_id)
  (+ one UPDATE ... SET resolved=true per issue actually fixed)
"""
from unittest.mock import patch

from src.jobs import data_quality_repair as repair
from tests.support.fake_db import FakeConnection

_JOB_NAMES = [
    "ingest_fp2", "ingest_qualifying", "ingest_race",
    "ingest_sprint", "ingest_sprint_qualifying",
    "compute_features", "compute_predictions", "compute_season_stats",
]


def _issue(**over):
    base = dict(
        id=1, race_id=10, round_number=5, year=2024,
        table_name="race_predictions", check_name="prediction_present",
        severity="high", detail="", fixable=True, is_sprint=False,
    )
    base.update(over)
    return base


class _Patched:
    """Patches get_conn + every job module in repair's namespace; exposes the mocks."""

    def __enter__(self):
        self._stack = []
        self.jobs = {}
        for name in _JOB_NAMES:
            p = patch.object(repair, name)
            self.jobs[name] = p.start()
            self._stack.append(p)
        return self

    def __exit__(self, *a):
        for p in self._stack:
            p.stop()
        return False


def _run(queued, *, year=2024, resolve_run=None):
    conn = FakeConnection(list(queued))
    with patch.object(repair, "get_conn", return_value=conn), _Patched() as pat:
        repair.run(year=year, resolve_run=resolve_run)
    return conn, pat.jobs


class TestRunSelection:
    def test_no_audit_run_for_year_exits_without_touching_jobs(self):
        conn, jobs = _run([None])
        assert all(not m.called for m in jobs.values())
        assert conn.closed is True

    def test_no_fixable_issues_exits_early(self):
        conn, jobs = _run([{"id": 7}, []])
        assert all(not m.called for m in jobs.values())

    def test_explicit_resolve_run_queries_by_id(self):
        conn, _ = _run([{"id": 99}, []], resolve_run=99)
        first_sql, first_params = conn.cursors[0].executed[0]
        assert "WHERE id=%s" in first_sql
        assert first_params == (99,)

    def test_default_selects_latest_run_for_year(self):
        conn, _ = _run([{"id": 3}, []])
        first_sql, first_params = conn.cursors[0].executed[0]
        assert "ORDER BY generated_at DESC" in first_sql
        assert first_params == (2024,)


class TestRepairExecution:
    def test_single_issue_runs_its_steps_and_marks_resolved(self):
        conn, jobs = _run([{"id": 1}, [_issue()], []])
        jobs["compute_predictions"].run.assert_called_once_with(10)
        update_sql, update_params = conn.cursors[-1].executed[0]
        assert "SET resolved=true" in update_sql
        assert update_params == (1,)
        assert conn.commits == 1

    def test_steps_are_unioned_across_issues_on_the_same_race(self):
        issues = [
            _issue(id=1, table_name="lap_times", check_name="lap_coverage"),
            _issue(id=2, table_name="race_results", check_name="row_count"),
        ]
        # 2 SELECTs + 2 resolve UPDATEs.
        conn, jobs = _run([{"id": 1}, issues, [], []])
        # lap_coverage -> [ingest_race, compute_features, compute_predictions]
        # row_count    -> [ingest_race, compute_season_stats]
        jobs["ingest_race"].run.assert_called_once_with(2024, 5)
        jobs["compute_features"].run.assert_called_once_with(10)
        jobs["compute_predictions"].run.assert_called_once_with(10)
        jobs["compute_season_stats"].run.assert_called_once_with(2024)

    def test_distinct_races_are_repaired_independently(self):
        issues = [
            _issue(id=1, race_id=10, round_number=5),
            _issue(id=2, race_id=11, round_number=6),
        ]
        conn, jobs = _run([{"id": 1}, issues, [], []])
        assert jobs["compute_predictions"].run.call_count == 2
        assert conn.commits == 2

    def test_issue_with_no_repair_path_is_skipped(self):
        issue = _issue(table_name="fp2_long_run_times", check_name="driver_coverage")
        conn, jobs = _run([{"id": 1}, [issue]])
        assert all(not m.called for m in jobs.values())
        assert conn.commits == 0

    def test_round_number_is_resolved_from_race_id_when_absent(self):
        issue = _issue(round_number=None, race_id=10,
                       table_name="race_results", check_name="row_count")
        # _run_ingest re-resolves the round from race_id on every step, so the
        # round lookup runs once per step (ingest_race, compute_season_stats),
        # then one UPDATE ... resolved.
        conn, jobs = _run(
            [{"id": 1}, [issue], {"round_number": 8}, {"round_number": 8}, []]
        )
        jobs["ingest_race"].run.assert_called_once_with(2024, 8)
        jobs["compute_season_stats"].run.assert_called_once_with(2024)

    def test_step_failure_rolls_back_and_leaves_issue_unresolved(self):
        conn = FakeConnection([{"id": 1}, [_issue(id=1)]])
        with patch.object(repair, "get_conn", return_value=conn), _Patched() as pat:
            pat.jobs["compute_predictions"].run.side_effect = RuntimeError("boom")
            repair.run(year=2024)
        assert conn.rollbacks == 1
        # No UPDATE ... resolved was issued.
        assert not any(
            "SET resolved=true" in sql
            for cur in conn.cursors for sql, _ in cur.executed
        )
        assert conn.commits == 0
