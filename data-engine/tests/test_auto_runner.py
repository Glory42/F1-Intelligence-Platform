from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from src import auto_runner
from src import enrichment_coverage as ec
from src import weekend_pipeline as wp
from src.utils.schedule_window import RaceWeekendWindow
from src.weekend_pipeline import ActionKind
from tests.support.fake_db import FakeConnection


def _utc(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _naive(dt):
    return pd.NaT if dt is None else pd.Timestamp(dt.replace(tzinfo=None))


def _schedule_with_race(round_number, race_utc):
    fp1 = race_utc - timedelta(days=2)
    return pd.DataFrame(
        [
            {
                "RoundNumber": round_number,
                "EventFormat": "conventional",
                "EventDate": _naive(race_utc),
                "Session1DateUtc": _naive(fp1),
                "Session2DateUtc": _naive(fp1 + timedelta(hours=4)),
                "Session3DateUtc": _naive(race_utc - timedelta(days=1, hours=3)),
                "Session4DateUtc": _naive(race_utc - timedelta(days=1)),
                "Session5DateUtc": _naive(race_utc),
            }
        ]
    )


class _SpyConnFactory:
    def __init__(self, conn=None):
        self.calls = 0
        self._conn = conn

    def __call__(self):
        self.calls += 1
        if self._conn is None:
            raise AssertionError("conn_factory was called but the test supplied no connection")
        return self._conn


class _SpyScheduleProvider:
    def __init__(self, schedule):
        self.calls = 0
        self._schedule = schedule

    def __call__(self):
        self.calls += 1
        return self._schedule


def _jobs(monkeypatch, **fakes):
    """Swaps entries of the pipeline's one job table: each fake takes the RaceRunContext."""
    for name, fake in fakes.items():
        monkeypatch.setitem(wp.JOBS, name, fake)


def _boom(error):
    def raise_(ctx):
        raise error
    return raise_


def _action(kind):
    return wp.Action(kind=kind, ready=True, label=kind.value)


_CTX = wp.RaceRunContext(race_id=1, year=2026, round_number=5)


def _active_race_row(race_id=1, round_number=1, year=2026, status="scheduled", event_format="sprint", name=None):
    row = {"id": race_id, "round_number": round_number, "year": year, "status": status, "event_format": event_format}
    if name is not None:
        row["name"] = name
    return row


class _FlakyOnceScheduleProvider:
    """Fails the first call (simulating the gate fetch hitting a transient outage),
    then succeeds on every call after."""

    def __init__(self, schedule):
        self.calls = 0
        self._schedule = schedule

    def __call__(self):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("transient FastF1 outage")
        return self._schedule


class TestRunScheduleGate:
    def test_does_not_touch_the_database_outside_a_race_weekend(self):
        spy = _SpyConnFactory()
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(days=4)  # window has not opened yet

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=spy,
        )

        assert spy.calls == 0

    def test_queries_the_database_when_inside_a_race_weekend(self):
        # First row answers the missing-race-events recheck (no race found -> no-op), second
        # answers the active-race query (no active race row -> run_cycle() exits cleanly).
        spy = _SpyConnFactory(FakeConnection([None, None]))
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(hours=6)  # Saturday evening, well inside the window

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=spy,
        )

        assert spy.calls == 1

    def test_falls_back_to_checking_the_database_when_the_schedule_fetch_fails(self):
        spy = _SpyConnFactory(FakeConnection([None]))

        def _boom():
            raise RuntimeError("FastF1 unreachable")

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=_utc(2026, 3, 4, 12, 0),
            schedule_provider=_boom,
            conn_factory=spy,
        )

        assert spy.calls == 1

    def test_fetches_the_schedule_only_once_per_cycle(self):
        # The gate fetch and the session-time lookup must reuse the same schedule:
        # not each trigger their own fastf1.get_event_schedule() call.
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(hours=6)
        provider = _SpyScheduleProvider(_schedule_with_race(1, race))
        conn = FakeConnection(
            [None, _active_race_row(status="unhandled_status", event_format="conventional")]
        )

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=provider,
            conn_factory=lambda: conn,
        )

        assert provider.calls == 1

    def test_resyncs_schedule_available_and_window_after_a_successful_retry(self):
        # The gate fetch fails, but the in-cycle retry (once we know which round to look up)
        # succeeds: the CycleResult must reflect that recovery, not the earlier failure.
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(hours=6)  # inside the window once the schedule is available
        provider = _FlakyOnceScheduleProvider(_schedule_with_race(1, race))
        conn = FakeConnection([_active_race_row(status="unhandled_status", event_format="conventional")])

        result = auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=provider,
            conn_factory=lambda: conn,
        )

        assert result.schedule_available is True
        assert result.window is not None
        assert result.window.contains(now)

    def test_checks_missing_race_events_for_the_windows_round_when_inside_it(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            auto_runner, "_retry_missing_race_events",
            lambda log_func, conn, round_number, year, memo=None: calls.append((round_number, year))
        )
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(hours=6)

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=lambda: FakeConnection([None]),
        )

        assert calls == [(1, 2026)]

    def test_does_not_check_missing_race_events_outside_the_window(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            auto_runner, "_retry_missing_race_events",
            lambda *a, **k: calls.append(1)
        )
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(days=4)  # window has not opened yet

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=lambda: FakeConnection([]),
        )

        assert calls == []


class TestPollIntervalForWindow:
    def test_active_when_now_is_inside_the_window(self):
        window = RaceWeekendWindow(round_number=1, start=_utc(2026, 3, 6), end=_utc(2026, 3, 9))
        secs = auto_runner.poll_interval_for_window(window, _utc(2026, 3, 8))
        assert secs == auto_runner.ACTIVE_POLL_SECONDS

    def test_idle_when_now_is_outside_the_window(self):
        window = RaceWeekendWindow(round_number=1, start=_utc(2026, 3, 6), end=_utc(2026, 3, 9))
        secs = auto_runner.poll_interval_for_window(window, _utc(2026, 2, 1))
        assert secs == auto_runner.IDLE_POLL_SECONDS

    def test_idle_when_there_is_no_window(self):
        secs = auto_runner.poll_interval_for_window(None, _utc(2026, 2, 1))
        assert secs == auto_runner.IDLE_POLL_SECONDS

    def test_active_when_schedule_was_unavailable(self):
        secs = auto_runner.poll_interval_for_window(None, _utc(2026, 2, 1), schedule_available=False)
        assert secs == auto_runner.ACTIVE_POLL_SECONDS


class TestRetryMissingRaceEvents:
    """Which coverage is due is enrichment_coverage.missing's job (test_enrichment_coverage.py);
    these cover running it: only missing jobs rerun, and the memo settles finished ones."""

    def _row(self, **gaps):
        return {"id": 1, "status": "completed", "sprint_date": None,
                **{c.flag: True for c in ec.COVERAGES}, **gaps}

    def _patch_jobs(self, monkeypatch, fail=()):
        calls = []

        def job(name):
            def run(ctx):
                calls.append(name)
                if name in fail:
                    raise RuntimeError("boom")
            return run

        for name in wp.JOBS:
            monkeypatch.setitem(wp.JOBS, name, job(name))
        return calls

    def _retry(self, row, memo=None):
        return auto_runner._retry_missing_race_events(lambda *_: None, FakeConnection([row]), 5, 2026, memo)

    def test_noop_when_race_not_found(self, monkeypatch):
        calls = self._patch_jobs(monkeypatch)
        assert self._retry(None) is True
        assert calls == []

    def test_noop_when_everything_is_covered(self, monkeypatch):
        calls = self._patch_jobs(monkeypatch)
        assert self._retry(self._row()) is True
        assert calls == []

    def test_reruns_only_the_jobs_whose_coverage_is_missing(self, monkeypatch):
        calls = self._patch_jobs(monkeypatch)
        self._retry(self._row(ingest_pit_stops=False, compute_title_odds=False))
        assert calls == ["ingest_pit_stops", "compute_title_odds"]

    def test_a_job_that_finished_cleanly_is_settled_even_if_its_table_stays_empty(self, monkeypatch):
        calls = self._patch_jobs(monkeypatch)
        memo = auto_runner.WorkerMemo()
        row = self._row(ingest_overtakes=False)

        assert self._retry(row, memo) is True
        assert self._retry(row, memo) is True
        assert calls == ["ingest_overtakes"]

    def test_a_failed_job_stays_pending_and_does_not_stop_the_others(self, monkeypatch):
        calls = self._patch_jobs(monkeypatch, fail={"ingest_race_control"})
        memo = auto_runner.WorkerMemo()
        row = self._row(ingest_race_control=False, ingest_overtakes=False)

        assert self._retry(row, memo) is False
        assert self._retry(row, memo) is False
        assert calls == ["ingest_race_control", "ingest_overtakes", "ingest_race_control"]

    def test_telemetry_that_ran_out_of_budget_stays_pending(self, monkeypatch):
        self._patch_jobs(monkeypatch)
        _jobs(monkeypatch, ingest_qualifying_telemetry=lambda ctx: False)
        memo = auto_runner.WorkerMemo()
        assert self._retry(self._row(ingest_qualifying_telemetry=False), memo) is False
        assert memo.settled == set()


class TestRunActionSteps:
    def test_all_steps_succeed_returns_ok_and_last_committed_status(self, monkeypatch):
        calls = []
        _jobs(
            monkeypatch,
            ingest_sprint_qualifying=lambda ctx: calls.append("ingest"),
            compute_sprint_features=lambda ctx: calls.append("features"),
            compute_sprint_predictions=lambda ctx: calls.append("predictions"),
            compute_title_odds=lambda ctx: None,
            ingest_qualifying_telemetry_sprint=lambda ctx: None,
        )

        outcome = auto_runner._run_action_steps(_action(ActionKind.SPRINT_QUALIFYING), _CTX)

        assert outcome == auto_runner.StepOutcome(
            ok=True, last_committed_status="sprint_qualifying_done", failed_step=None, error=None
        )
        assert calls == ["ingest", "features", "predictions"]

    def test_step_failure_returns_last_committed_status_and_failed_step(self, monkeypatch):
        boom = RuntimeError("boom")
        _jobs(
            monkeypatch,
            ingest_sprint_qualifying=lambda ctx: None,
            compute_sprint_features=_boom(boom),
            compute_sprint_predictions=lambda ctx: pytest.fail("the sequence must stop at the failing step"),
        )

        outcome = auto_runner._run_action_steps(_action(ActionKind.SPRINT_QUALIFYING), _CTX)

        assert outcome.ok is False
        assert outcome.last_committed_status == "sprint_qualifying_done"
        assert outcome.failed_step == "compute_sprint_features"
        assert outcome.error is boom

    def test_race_events_failure_does_not_fail_the_main_race_sequence(self, monkeypatch):
        _jobs(monkeypatch, **{step.name: (lambda ctx: None) for step in wp.chain(ActionKind.MAIN_RACE)})
        _jobs(monkeypatch, ingest_race_control=_boom(RuntimeError("boom")))

        outcome = auto_runner._run_action_steps(_action(ActionKind.MAIN_RACE), _CTX)

        assert outcome.ok is True
        assert outcome.last_committed_status == "completed"

    def test_a_title_odds_failure_does_not_fail_the_action(self, monkeypatch):
        _jobs(
            monkeypatch,
            ingest_sprint=lambda ctx: None,
            compute_season_stats=lambda ctx: None,
            compute_title_odds=_boom(RuntimeError("boom")),
        )

        outcome = auto_runner._run_action_steps(_action(ActionKind.SPRINT_RACE), _CTX)

        assert outcome.ok is True


class TestRevertRaceStatus:
    def test_reverts_to_pre_sequence_status_when_nothing_committed(self):
        conn = FakeConnection([None])
        ctx = wp.RaceRunContext(race_id=7, year=2026, round_number=3)

        auto_runner.revert_race_status(
            lambda: conn, ctx, None, "scheduled", RuntimeError("boom"), "ingest_sprint_qualifying"
        )

        _, params = conn.cursors[-1].executed[-1]
        assert params == ("scheduled", 7)
        assert conn.commits == 1
        assert conn.closed is True

    def test_reverts_to_last_committed_status_not_pre_sequence_status(self):
        conn = FakeConnection([None])
        ctx = wp.RaceRunContext(race_id=7, year=2026, round_number=3)

        auto_runner.revert_race_status(
            lambda: conn,
            ctx,
            "sprint_qualifying_done",
            "scheduled",
            RuntimeError("boom"),
            "compute_sprint_features",
        )

        _, params = conn.cursors[-1].executed[-1]
        assert params == ("sprint_qualifying_done", 7)

    def test_opens_its_own_connection_rather_than_reusing_one(self):
        # Regression guard: revert must not reuse a connection that's been idle for the
        # whole (potentially long) job sequence: it should ask conn_factory for a fresh one.
        conn = FakeConnection([None])
        factory_calls = []

        def conn_factory():
            factory_calls.append(1)
            return conn

        ctx = wp.RaceRunContext(race_id=7, year=2026, round_number=3)

        auto_runner.revert_race_status(conn_factory, ctx, None, "scheduled", RuntimeError("boom"), "ingest_race")

        assert len(factory_calls) == 1


class TestRunCycleSequenceRetry:
    def test_step_failure_mid_sequence_then_next_cycle_resumes_from_committed_status(self, monkeypatch):
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(days=2) + timedelta(hours=6)  # Sprint Qualifying is ready

        _jobs(
            monkeypatch,
            ingest_sprint_qualifying=lambda ctx: None,
            compute_sprint_features=_boom(ConnectionError("boom")),
            compute_sprint_predictions=lambda ctx: pytest.fail("compute_sprint_features already failed"),
        )

        # First row answers the missing-race-events recheck (no race found -> no-op), second
        # answers the active-race query, third is revert_race_status's UPDATE.
        conn = FakeConnection([None, _active_race_row(), None])

        with pytest.raises(ConnectionError, match="boom"):
            auto_runner.run_cycle(
                log_func=lambda *_: None,
                now_utc=now,
                schedule_provider=lambda: _schedule_with_race(1, race),
                conn_factory=lambda: conn,
            )

        # revert wrote the status the sequence actually committed (step 1), not the
        # pre-sequence "scheduled" value
        _, revert_params = conn.cursors[-1].executed[-1]
        assert revert_params == ("sprint_qualifying_done", 1)

        # the next cycle's decision resumes past the already-completed step instead
        # of redoing it
        event = _schedule_with_race(1, race).iloc[0]
        next_action = wp.plan(status="sprint_qualifying_done", is_sprint=True, event=event, now=now)
        assert next_action.kind == ActionKind.SPRINT_RACE


class TestQuietCyclesBetweenSessions:
    """Each in-window DB visit wakes Neon Free compute for >= 5 min; once a cycle has seen the
    race's status, later cycles can tell from the schedule alone that nothing is due yet."""

    def test_skips_the_database_until_the_pending_action_is_ready(self):
        race = _utc(2026, 3, 8, 4, 0)
        friday = race - timedelta(days=2) + timedelta(hours=1)  # FP1 done, qualifying a day away
        memo = auto_runner.WorkerMemo()
        first = FakeConnection([None, _active_race_row(status="scheduled", event_format="conventional")])

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=friday,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=lambda: first,
            memo=memo,
        )
        spy = _SpyConnFactory()
        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=friday + timedelta(minutes=20),
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=spy,
            memo=memo,
        )

        assert spy.calls == 0

    def test_keeps_checking_while_fp2_coverage_is_below_the_gate(self, monkeypatch):
        _jobs(monkeypatch, ingest_fp2=lambda ctx: None)
        race = _utc(2026, 3, 8, 4, 0)
        saturday_night = race - timedelta(hours=6)  # qualifying ingested, race not yet run
        memo = auto_runner.WorkerMemo()
        first = FakeConnection([
            None,
            _active_race_row(status="qualifying_done", event_format="conventional"),
            {"n": 5}, {"n": 20},  # FP2 coverage before the retry: 25%
            {"n": 5}, {"n": 20},  # ...and still 25% after it
        ])

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=saturday_night,
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=lambda: first,
            memo=memo,
        )
        spy = _SpyConnFactory(FakeConnection([None, None]))
        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=saturday_night + timedelta(minutes=20),
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=spy,
            memo=memo,
        )

        assert spy.calls == 1

    def test_checks_the_database_when_the_schedule_has_no_time_for_the_pending_session(self):
        race = _utc(2026, 3, 8, 4, 0)
        friday = race - timedelta(days=2) + timedelta(hours=1)
        memo = auto_runner.WorkerMemo()
        first = FakeConnection([None, _active_race_row(status="scheduled", event_format="conventional")])
        auto_runner.run_cycle(
            log_func=lambda *_: None, now_utc=friday,
            schedule_provider=lambda: _schedule_with_race(1, race), conn_factory=lambda: first, memo=memo,
        )
        timeless = _schedule_with_race(1, race)
        timeless["Session4DateUtc"] = pd.NaT

        spy = _SpyConnFactory(FakeConnection([None, None]))
        auto_runner.run_cycle(
            log_func=lambda *_: None, now_utc=friday + timedelta(minutes=20),
            schedule_provider=lambda: timeless, conn_factory=spy, memo=memo,
        )

        assert spy.calls == 1

    def test_keeps_checking_while_the_windows_race_is_missing_race_events(self, monkeypatch):
        _jobs(monkeypatch, ingest_race_control=lambda ctx: False)
        race = _utc(2026, 3, 8, 4, 0)
        next_race = race + timedelta(days=14)
        schedule = pd.concat([_schedule_with_race(1, race), _schedule_with_race(2, next_race)], ignore_index=True)
        sunday_evening = race + timedelta(hours=8)
        memo = auto_runner.WorkerMemo()
        first = FakeConnection([
            {"id": 1, "status": "completed", "sprint_date": None, "ingest_race_control": False},
            _active_race_row(race_id=2, round_number=2, status="scheduled", event_format="conventional"),
        ])

        auto_runner.run_cycle(
            log_func=lambda *_: None, now_utc=sunday_evening,
            schedule_provider=lambda: schedule, conn_factory=lambda: first, memo=memo,
        )
        spy = _SpyConnFactory(FakeConnection([None, None]))
        auto_runner.run_cycle(
            log_func=lambda *_: None, now_utc=sunday_evening + timedelta(minutes=20),
            schedule_provider=lambda: schedule, conn_factory=spy, memo=memo,
        )

        assert spy.calls == 1


class TestCycleOpenF1Budget:
    def test_each_cycle_starts_with_a_fresh_openf1_request_budget(self):
        from src.utils import openf1_client

        openf1_client.reset_request_budget(limit=0)
        race = _utc(2026, 3, 8, 4, 0)

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=race - timedelta(days=4),
            schedule_provider=lambda: _schedule_with_race(1, race),
            conn_factory=_SpyConnFactory(),
        )

        assert openf1_client.remaining_requests() == openf1_client.DEFAULT_REQUEST_BUDGET


class TestStepMemoryLog:
    def test_each_step_logs_the_process_peak_rss_for_render_free_headroom(self, monkeypatch, capsys):
        import json

        _jobs(
            monkeypatch,
            ingest_sprint=lambda ctx: None,
            compute_season_stats=lambda ctx: None,
            compute_title_odds=lambda ctx: None,
        )

        auto_runner._run_action_steps(_action(ActionKind.SPRINT_RACE), _CTX)

        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
        assert [line["job"] for line in lines] == ["ingest_sprint", "compute_season_stats", "compute_title_odds"]
        assert all(line["status"] == "ok" and isinstance(line["peak_rss_mb"], int) for line in lines)


class TestRunCycleCalendarDrift:
    def test_resyncs_the_schedule_instead_of_ingesting_when_the_round_is_now_a_different_race(self, monkeypatch):
        # The DB still has Singapore at round 16, but FastF1 has since put Bahrain there.
        race = _utc(2026, 10, 4, 7, 0)
        now = race + timedelta(hours=6)
        schedule = _schedule_with_race(16, race).assign(EventName="Bahrain Grand Prix")
        synced = []
        monkeypatch.setattr(auto_runner.sync_schedule, "run", lambda year, schedule=None: synced.append((year, schedule)))
        _jobs(monkeypatch, ingest_sprint_qualifying=lambda ctx: pytest.fail("must not ingest another event's session"))
        conn = FakeConnection([None, _active_race_row(race_id=286, round_number=16, name="Singapore Grand Prix")])

        auto_runner.run_cycle(
            log_func=lambda *_: None,
            now_utc=now,
            schedule_provider=lambda: schedule,
            conn_factory=lambda: conn,
        )

        assert len(synced) == 1
        assert synced[0][0] == 2026
        assert synced[0][1] is schedule
