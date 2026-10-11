from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from src import auto_runner
from src.utils.schedule_window import RaceWeekendWindow
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
        # The gate fetch and the session-time lookup must reuse the same schedule —
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
        # succeeds — the CycleResult must reflect that recovery, not the earlier failure.
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
            lambda log_func, conn, round_number, year: calls.append((round_number, year))
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


class TestDecideNextAction:
    _race = _utc(2026, 3, 8, 4, 0)
    _event = _schedule_with_race(1, _race).iloc[0]

    def test_sprint_scheduled_returns_sprint_qualifying(self):
        # Session2DateUtc + 1.5h delay has passed
        now = self._race - timedelta(days=2) + timedelta(hours=6)
        action = auto_runner.decide_next_action(status="scheduled", is_sprint=True, event=self._event, now=now)
        assert action.kind == auto_runner.ActionKind.SPRINT_QUALIFYING
        assert action.ready is True
        assert action.label == "Sprint Qualifying"
        assert action.steps is auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_QUALIFYING]

    def test_sprint_after_qualifying_returns_sprint_race(self):
        # Session3DateUtc + 1.5h delay has NOT passed yet
        now = self._race - timedelta(days=1, hours=2)
        action = auto_runner.decide_next_action(
            status="sprint_qualifying_done", is_sprint=True, event=self._event, now=now
        )
        assert action.kind == auto_runner.ActionKind.SPRINT_RACE
        assert action.ready is False
        assert action.label == "Sprint Race"
        assert action.steps is auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_RACE]

    def test_sprint_after_sprint_race_returns_main_qualifying(self):
        # Session4DateUtc + 2h delay has passed
        now = self._race - timedelta(days=1) + timedelta(hours=3)
        action = auto_runner.decide_next_action(status="sprint_done", is_sprint=True, event=self._event, now=now)
        assert action.kind == auto_runner.ActionKind.MAIN_QUALIFYING
        assert action.ready is True
        assert action.label == "Main Qualifying"
        assert action.steps is auto_runner._ACTION_JOBS[auto_runner.ActionKind.MAIN_QUALIFYING]

    def test_conventional_scheduled_returns_main_qualifying(self):
        # Session4DateUtc + 2h delay has NOT passed yet
        now = self._race - timedelta(days=1, hours=1)
        action = auto_runner.decide_next_action(status="scheduled", is_sprint=False, event=self._event, now=now)
        assert action.kind == auto_runner.ActionKind.MAIN_QUALIFYING
        assert action.ready is False
        assert action.label == "Main Qualifying"
        assert action.steps is auto_runner._ACTION_JOBS[auto_runner.ActionKind.MAIN_QUALIFYING]

    def test_qualifying_done_returns_main_race(self):
        # Session5DateUtc + 3h delay has passed
        now = self._race + timedelta(hours=4)
        action = auto_runner.decide_next_action(status="qualifying_done", is_sprint=False, event=self._event, now=now)
        assert action.kind == auto_runner.ActionKind.MAIN_RACE
        assert action.ready is True
        assert action.label == "Main Race"
        assert action.steps is auto_runner._ACTION_JOBS[auto_runner.ActionKind.MAIN_RACE]

    def test_unhandled_status_returns_none(self):
        action = auto_runner.decide_next_action(
            status="completed", is_sprint=False, event=self._event, now=self._race
        )
        assert action is None

    def test_main_race_includes_race_events_ingestion_after_the_core_pipeline(self):
        names = [step.name for step in auto_runner._ACTION_JOBS[auto_runner.ActionKind.MAIN_RACE]]
        assert names == [
            "ingest_race",
            "compute_season_stats",
            "compute_title_odds",
            "ingest_race_control",
            "ingest_overtakes",
            "ingest_team_radio",
            "ingest_stints",
            "ingest_pit_stops",
            "ingest_race_control_sprint",
            "ingest_overtakes_sprint",
            "ingest_team_radio_sprint",
            "ingest_stints_sprint",
            "ingest_pit_stops_sprint",
            "ingest_qualifying_telemetry",
            "ingest_sprint_qualifying_telemetry",
        ]


class TestRunOpenF1Step:
    def test_success_calls_through_with_year_and_round(self):
        calls = []
        ctx = auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5)

        auto_runner._run_openf1_step(lambda y, r: calls.append((y, r)), "ingest_race_control", ctx)

        assert calls == [(2026, 5)]

    def test_failure_is_swallowed_and_logged_rather_than_raised(self, monkeypatch):
        logged = []
        monkeypatch.setattr(
            auto_runner, "log_job_failure",
            lambda job, error, **context: logged.append((job, str(error), context)),
        )
        ctx = auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5)

        def _boom(y, r):
            raise RuntimeError("OpenF1 429")

        auto_runner._run_openf1_step(_boom, "ingest_team_radio", ctx)

        assert logged == [("ingest_team_radio", "OpenF1 429", {"race_id": 1, "year": 2026, "round": 5})]

    def test_race_events_failure_does_not_fail_the_main_race_sequence(self, monkeypatch):
        monkeypatch.setattr(auto_runner.ingest_race, "run", lambda y, r: None)
        monkeypatch.setattr(auto_runner.compute_season_stats, "run", lambda y: None)
        monkeypatch.setattr(
            auto_runner.ingest_race_control, "run",
            lambda y, r, session_name="Race": (_ for _ in ()).throw(RuntimeError("boom"))
        )
        monkeypatch.setattr(auto_runner.ingest_overtakes, "run", lambda y, r, session_name="Race": None)
        monkeypatch.setattr(auto_runner.ingest_team_radio, "run", lambda y, r, session_name="Race": None)

        action = auto_runner.Action(
            kind=auto_runner.ActionKind.MAIN_RACE,
            ready=True,
            label="Main Race",
            steps=auto_runner._ACTION_JOBS[auto_runner.ActionKind.MAIN_RACE],
        )
        ctx = auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5)

        outcome = auto_runner._run_action_steps(action, ctx)

        assert outcome.ok is True
        assert outcome.last_committed_status == "completed"


class TestRetryMissingRaceEvents:
    def _row(self, **overrides):
        row = {"id": 1, "status": "completed", "sprint_date": None, "has_race_control": False, "telemetry_complete": True}
        row.update(overrides)
        return row

    def _patch_openf1_jobs(self, monkeypatch):
        calls = []
        for job in (
            auto_runner.ingest_race_control, auto_runner.ingest_overtakes, auto_runner.ingest_team_radio,
            auto_runner.ingest_stints, auto_runner.ingest_pit_stops,
        ):
            name = job.__name__.rsplit(".", 1)[-1]
            monkeypatch.setattr(
                job, "run",
                lambda y, r, session_name="Race", _name=name: calls.append((_name, session_name))
            )
        return calls

    def test_noop_when_race_not_found(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([None])

        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == []

    def test_noop_when_race_not_completed(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([self._row(status="qualifying_done")])

        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == []

    def test_noop_when_race_control_already_present(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([self._row(has_race_control=True)])

        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == []

    def test_retries_race_session_jobs_when_completed_and_missing(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([self._row()])

        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == [
            ("ingest_race_control", "Race"),
            ("ingest_overtakes", "Race"),
            ("ingest_team_radio", "Race"),
            ("ingest_stints", "Race"),
            ("ingest_pit_stops", "Race"),
        ]

    def test_also_retries_sprint_session_jobs_when_sprint_date_present(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([self._row(sprint_date=datetime(2026, 3, 7, 15, 0, tzinfo=timezone.utc))])

        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == [
            ("ingest_race_control", "Race"),
            ("ingest_overtakes", "Race"),
            ("ingest_team_radio", "Race"),
            ("ingest_stints", "Race"),
            ("ingest_pit_stops", "Race"),
            ("ingest_race_control", "Sprint"),
            ("ingest_overtakes", "Sprint"),
            ("ingest_team_radio", "Sprint"),
            ("ingest_stints", "Sprint"),
            ("ingest_pit_stops", "Sprint"),
        ]

    def test_retries_only_the_sprint_session_when_just_its_race_control_is_missing(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        conn = FakeConnection([self._row(
            sprint_date=datetime(2026, 3, 7, 15, 0, tzinfo=timezone.utc),
            has_race_control=True,
            has_sprint_race_control=False,
        )])

        settled = auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == [
            ("ingest_race_control", "Sprint"),
            ("ingest_overtakes", "Sprint"),
            ("ingest_team_radio", "Sprint"),
            ("ingest_stints", "Sprint"),
            ("ingest_pit_stops", "Sprint"),
        ]
        assert settled is False

    def test_resumes_qualifying_telemetry_until_every_qualifier_is_stored(self, monkeypatch):
        calls = self._patch_openf1_jobs(monkeypatch)
        telemetry_calls = []
        monkeypatch.setattr(
            auto_runner.ingest_qualifying_telemetry, "run",
            lambda y, r, session_type="Q": telemetry_calls.append(session_type),
        )
        conn = FakeConnection([self._row(has_race_control=True, telemetry_complete=False)])

        settled = auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == []
        assert telemetry_calls == ["Q", "SQ"]
        assert settled is False

    def test_a_failure_in_one_job_does_not_stop_the_others(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            auto_runner.ingest_race_control, "run",
            lambda y, r, session_name="Race": (_ for _ in ()).throw(RuntimeError("boom"))
        )
        monkeypatch.setattr(
            auto_runner.ingest_overtakes, "run",
            lambda y, r, session_name="Race": calls.append(("ingest_overtakes", session_name))
        )
        for job in (auto_runner.ingest_team_radio, auto_runner.ingest_stints, auto_runner.ingest_pit_stops):
            name = job.__name__.rsplit(".", 1)[-1]
            monkeypatch.setattr(
                job, "run", lambda y, r, session_name="Race", _name=name: calls.append((_name, session_name))
            )
        conn = FakeConnection([self._row()])

        # Must not raise — each job goes through the same non-fatal _run_openf1_step wrapper.
        auto_runner._retry_missing_race_events(lambda *_: None, conn, round_number=5, year=2026)

        assert calls == [
            ("ingest_overtakes", "Race"), ("ingest_team_radio", "Race"),
            ("ingest_stints", "Race"), ("ingest_pit_stops", "Race"),
        ]


class TestRunActionSteps:
    def test_all_steps_succeed_returns_ok_and_last_committed_status(self, monkeypatch):
        calls = []
        monkeypatch.setattr(auto_runner.ingest_sprint_qualifying, "run", lambda y, r: calls.append("ingest"))
        monkeypatch.setattr(auto_runner.compute_sprint_features, "run", lambda rid: calls.append("features"))
        monkeypatch.setattr(auto_runner.compute_sprint_predictions, "run", lambda rid: calls.append("predictions"))

        action = auto_runner.Action(
            kind=auto_runner.ActionKind.SPRINT_QUALIFYING,
            ready=True,
            label="Sprint Qualifying",
            steps=auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_QUALIFYING],
        )
        ctx = auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5)

        outcome = auto_runner._run_action_steps(action, ctx)

        assert outcome == auto_runner.StepOutcome(
            ok=True, last_committed_status="sprint_qualifying_done", failed_step=None, error=None
        )
        assert calls == ["ingest", "features", "predictions"]

    def test_step_failure_returns_last_committed_status_and_failed_step(self, monkeypatch):
        boom = RuntimeError("boom")

        def _raise(race_id):
            raise boom

        monkeypatch.setattr(auto_runner.ingest_sprint_qualifying, "run", lambda y, r: None)
        monkeypatch.setattr(auto_runner.compute_sprint_features, "run", _raise)
        monkeypatch.setattr(
            auto_runner.compute_sprint_predictions,
            "run",
            lambda rid: pytest.fail("should not run — the sequence must stop at the failing step"),
        )

        action = auto_runner.Action(
            kind=auto_runner.ActionKind.SPRINT_QUALIFYING,
            ready=True,
            label="Sprint Qualifying",
            steps=auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_QUALIFYING],
        )
        ctx = auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5)

        outcome = auto_runner._run_action_steps(action, ctx)

        assert outcome.ok is False
        assert outcome.last_committed_status == "sprint_qualifying_done"
        assert outcome.failed_step == "compute_sprint_features"
        assert outcome.error is boom


class TestRevertRaceStatus:
    def test_reverts_to_pre_sequence_status_when_nothing_committed(self):
        conn = FakeConnection([None])
        ctx = auto_runner.RaceRunContext(race_id=7, year=2026, round_number=3)

        auto_runner.revert_race_status(
            lambda: conn, ctx, None, "scheduled", RuntimeError("boom"), "ingest_sprint_qualifying"
        )

        _, params = conn.cursors[-1].executed[-1]
        assert params == ("scheduled", 7)
        assert conn.commits == 1
        assert conn.closed is True

    def test_reverts_to_last_committed_status_not_pre_sequence_status(self):
        conn = FakeConnection([None])
        ctx = auto_runner.RaceRunContext(race_id=7, year=2026, round_number=3)

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
        # whole (potentially long) job sequence — it should ask conn_factory for a fresh one.
        conn = FakeConnection([None])
        factory_calls = []

        def conn_factory():
            factory_calls.append(1)
            return conn

        ctx = auto_runner.RaceRunContext(race_id=7, year=2026, round_number=3)

        auto_runner.revert_race_status(conn_factory, ctx, None, "scheduled", RuntimeError("boom"), "ingest_race")

        assert len(factory_calls) == 1


class TestRunCycleSequenceRetry:
    def test_step_failure_mid_sequence_then_next_cycle_resumes_from_committed_status(self, monkeypatch):
        race = _utc(2026, 3, 8, 4, 0)
        now = race - timedelta(days=2) + timedelta(hours=6)  # Sprint Qualifying is ready

        monkeypatch.setattr(auto_runner.ingest_sprint_qualifying, "run", lambda y, r: None)

        def _raise(race_id):
            raise ConnectionError("boom")

        monkeypatch.setattr(auto_runner.compute_sprint_features, "run", _raise)
        monkeypatch.setattr(
            auto_runner.compute_sprint_predictions,
            "run",
            lambda rid: pytest.fail("should not run — compute_sprint_features already failed"),
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
        next_action = auto_runner.decide_next_action(
            status="sprint_qualifying_done", is_sprint=True, event=event, now=now
        )
        assert next_action.kind == auto_runner.ActionKind.SPRINT_RACE


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
        monkeypatch.setattr(auto_runner.ingest_fp2, "run", lambda year, round_number: None)
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
        monkeypatch.setattr(auto_runner, "_run_openf1_step", lambda job_run, step_name, ctx: None)
        race = _utc(2026, 3, 8, 4, 0)
        next_race = race + timedelta(days=14)
        schedule = pd.concat([_schedule_with_race(1, race), _schedule_with_race(2, next_race)], ignore_index=True)
        sunday_evening = race + timedelta(hours=8)
        memo = auto_runner.WorkerMemo()
        first = FakeConnection([
            {"id": 1, "status": "completed", "sprint_date": None, "has_race_control": False},
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

        monkeypatch.setattr(auto_runner.ingest_sprint, "run", lambda y, r: None)
        monkeypatch.setattr(auto_runner.compute_season_stats, "run", lambda year: None)
        monkeypatch.setattr(auto_runner.compute_title_odds, "run", lambda year: None)
        action = auto_runner.Action(
            kind=auto_runner.ActionKind.SPRINT_RACE,
            ready=True,
            label="Sprint Race",
            steps=auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_RACE],
        )

        auto_runner._run_action_steps(action, auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5))

        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
        assert [line["job"] for line in lines] == ["ingest_sprint", "compute_season_stats", "compute_title_odds"]
        assert all(line["status"] == "ok" and isinstance(line["peak_rss_mb"], int) for line in lines)


class TestTitleOddsSteps:
    @pytest.mark.parametrize("kind", list(auto_runner.ActionKind))
    def test_every_action_refreshes_title_odds_after_its_core_steps(self, kind):
        names = [step.name for step in auto_runner._ACTION_JOBS[kind]]
        core = [n for n in names if not n.startswith("ingest_") or n in ("ingest_race", "ingest_sprint", "ingest_qualifying", "ingest_sprint_qualifying", "ingest_fp2")]

        assert "compute_title_odds" in names
        assert names.index("compute_title_odds") > max(names.index(n) for n in core if n != "compute_title_odds")

    def test_a_title_odds_failure_does_not_fail_the_action(self, monkeypatch):
        monkeypatch.setattr(auto_runner.ingest_sprint, "run", lambda y, r: None)
        monkeypatch.setattr(auto_runner.compute_season_stats, "run", lambda year: None)
        monkeypatch.setattr(
            auto_runner.compute_title_odds, "run", lambda year: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        action = auto_runner.Action(
            kind=auto_runner.ActionKind.SPRINT_RACE, ready=True, label="Sprint Race",
            steps=auto_runner._ACTION_JOBS[auto_runner.ActionKind.SPRINT_RACE],
        )

        outcome = auto_runner._run_action_steps(action, auto_runner.RaceRunContext(race_id=1, year=2026, round_number=5))

        assert outcome.ok is True

class TestRunCycleCalendarDrift:
    def test_resyncs_the_schedule_instead_of_ingesting_when_the_round_is_now_a_different_race(self, monkeypatch):
        # The DB still has Singapore at round 16, but FastF1 has since put Bahrain there.
        race = _utc(2026, 10, 4, 7, 0)
        now = race + timedelta(hours=6)
        schedule = _schedule_with_race(16, race).assign(EventName="Bahrain Grand Prix")
        synced = []
        monkeypatch.setattr(auto_runner.sync_schedule, "run", lambda year, schedule=None: synced.append((year, schedule)))
        monkeypatch.setattr(
            auto_runner.ingest_sprint_qualifying, "run",
            lambda y, r: pytest.fail("must not ingest another event's session"),
        )
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
