from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from src import weekend_pipeline as wp
from src.weekend_pipeline import ActionKind


def _utc(year, month, day, hour=0, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _naive(dt):
    return pd.Timestamp(dt.replace(tzinfo=None))


_RACE = _utc(2026, 3, 8, 4, 0)
_FP1 = _RACE - timedelta(days=2)
_EVENT = pd.Series({
    "RoundNumber": 1,
    "Session1DateUtc": _naive(_FP1),
    "Session2DateUtc": _naive(_FP1 + timedelta(hours=4)),
    "Session3DateUtc": _naive(_RACE - timedelta(days=1, hours=3)),
    "Session4DateUtc": _naive(_RACE - timedelta(days=1)),
    "Session5DateUtc": _naive(_RACE),
})


class TestPlan:
    def test_a_scheduled_sprint_weekend_plans_sprint_qualifying(self):
        # Session2 (SQ) started at FP1+4h; +1.5h readiness delay has passed by FP1+6h.
        action = wp.plan("scheduled", True, _EVENT, _FP1 + timedelta(hours=6))
        assert action.kind == ActionKind.SPRINT_QUALIFYING
        assert action.ready is True
        assert action.label == "Sprint Qualifying"
        assert action.ready_at == _FP1 + timedelta(hours=5, minutes=30)

    def test_sprint_qualifying_done_plans_the_sprint_race_once_it_is_over(self):
        action = wp.plan("sprint_qualifying_done", True, _EVENT, _RACE - timedelta(days=1, hours=2))
        assert action.kind == ActionKind.SPRINT_RACE
        assert action.ready is False
        assert action.label == "Sprint Race"

    def test_sprint_done_plans_main_qualifying(self):
        action = wp.plan("sprint_done", True, _EVENT, _RACE - timedelta(days=1) + timedelta(hours=3))
        assert action.kind == ActionKind.MAIN_QUALIFYING
        assert action.ready is True
        assert action.label == "Main Qualifying"

    def test_a_scheduled_conventional_weekend_plans_main_qualifying(self):
        action = wp.plan("scheduled", False, _EVENT, _RACE - timedelta(days=1, hours=1))
        assert action.kind == ActionKind.MAIN_QUALIFYING
        assert action.ready is False

    def test_qualifying_done_plans_the_main_race_three_hours_after_it_starts(self):
        action = wp.plan("qualifying_done", False, _EVENT, _RACE + timedelta(hours=4))
        assert action.kind == ActionKind.MAIN_RACE
        assert action.ready is True
        assert action.ready_at == _RACE + timedelta(hours=3)

    def test_a_completed_weekend_needs_nothing(self):
        assert wp.plan("completed", False, _EVENT, _RACE) is None

    def test_sprint_statuses_mean_nothing_on_a_conventional_weekend(self):
        assert wp.plan("sprint_done", False, _EVENT, _RACE) is None

    def test_a_session_missing_from_the_schedule_is_never_ready(self):
        event = _EVENT.copy()
        event["Session4DateUtc"] = pd.NaT
        action = wp.plan("scheduled", False, event, _RACE)
        assert action.ready is False
        assert action.ready_at is None


class TestChain:
    def test_main_race_runs_race_events_after_the_core_pipeline(self):
        assert [s.name for s in wp.chain(ActionKind.MAIN_RACE)] == [
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
        ]

    def test_telemetry_runs_as_soon_as_its_qualifying_session_is_ingested(self):
        assert wp.chain(ActionKind.MAIN_QUALIFYING)[-1].name == "ingest_qualifying_telemetry"
        assert wp.chain(ActionKind.SPRINT_QUALIFYING)[-1].name == "ingest_qualifying_telemetry_sprint"

    @pytest.mark.parametrize("kind", list(ActionKind))
    def test_every_chain_refreshes_title_odds_after_its_core_steps(self, kind):
        steps = wp.chain(kind)
        names = [s.name for s in steps]
        last_core = max(i for i, s in enumerate(steps) if not s.optional)
        assert names.index("compute_title_odds") > last_core

    @pytest.mark.parametrize("kind", list(ActionKind))
    def test_each_chain_starts_with_the_ingest_that_moves_the_race_status(self, kind):
        steps = wp.chain(kind)
        assert steps[0].commits_status is not None
        assert all(s.commits_status is None for s in steps[1:])

    def test_every_step_has_a_job(self):
        assert {s.name for kind in ActionKind for s in wp.chain(kind)} <= set(wp.JOBS)


_CTX = wp.RaceRunContext(race_id=1, year=2026, round_number=5)


class TestJobStep:
    def test_runs_its_job_with_the_race_context(self, monkeypatch):
        calls = []
        monkeypatch.setitem(wp.JOBS, "ingest_race", calls.append)
        assert wp.JobStep("ingest_race").run(_CTX) is True
        assert calls == [_CTX]

    def test_a_core_step_failure_propagates(self, monkeypatch):
        monkeypatch.setitem(wp.JOBS, "compute_features", lambda ctx: (_ for _ in ()).throw(RuntimeError("boom")))
        with pytest.raises(RuntimeError, match="boom"):
            wp.JobStep("compute_features").run(_CTX)

    def test_an_optional_step_failure_is_logged_not_raised(self, monkeypatch):
        logged = []
        monkeypatch.setattr(wp, "log_job_failure", lambda job, error, **context: logged.append((job, str(error), context)))
        monkeypatch.setitem(wp.JOBS, "ingest_team_radio", lambda ctx: (_ for _ in ()).throw(RuntimeError("OpenF1 429")))

        assert wp.JobStep("ingest_team_radio", optional=True).run(_CTX) is False
        assert logged == [("ingest_team_radio", "OpenF1 429", {"race_id": 1, "year": 2026, "round": 5})]

    def test_an_optional_job_returning_false_has_not_finished(self, monkeypatch):
        monkeypatch.setitem(wp.JOBS, "ingest_qualifying_telemetry", lambda ctx: False)
        assert wp.JobStep("ingest_qualifying_telemetry", optional=True).run(_CTX) is False

    def test_sprint_race_events_pull_the_sprint_session(self, monkeypatch):
        calls = []
        monkeypatch.setattr(wp.ingest_stints, "run", lambda y, r, session_name: calls.append((y, r, session_name)))
        wp.JobStep("ingest_stints_sprint", optional=True).run(_CTX)
        assert calls == [(2026, 5, "Sprint")]


class TestDueStatuses:
    def test_an_ingest_is_due_where_its_chain_is_planned(self):
        assert wp.due_statuses("ingest_race") == ("qualifying_done",)
        assert wp.due_statuses("ingest_qualifying") == ("scheduled", "sprint_done")
        assert wp.due_statuses("ingest_sprint_qualifying") == ("scheduled",)
        assert wp.due_statuses("ingest_sprint") == ("sprint_qualifying_done",)

    def test_a_step_after_the_ingest_is_due_from_the_status_it_committed_onwards(self):
        assert wp.due_statuses("ingest_qualifying_telemetry") == ("qualifying_done", "completed")
        assert wp.due_statuses("ingest_qualifying_telemetry_sprint") == (
            "sprint_qualifying_done", "sprint_done", "qualifying_done", "completed",
        )
        assert wp.due_statuses("ingest_stints_sprint") == ("completed",)

    def test_a_step_in_several_chains_is_due_wherever_any_of_them_ran(self):
        assert wp.due_statuses("compute_season_stats") == ("sprint_done", "qualifying_done", "completed")

    def test_a_coverage_retry_step_is_due_once_its_ingest_has_run(self):
        assert wp.due_statuses("ingest_race_story_sprint") == ("completed",)
        assert wp.stage_of("ingest_race_story").races_date_sql == "r.race_date::date"


class TestRepairSteps:
    def test_a_race_results_repair_reruns_what_the_worker_runs_after_the_race(self):
        assert [s.name for s in wp.repair_steps("race_results", "points_present")] == [
            "ingest_race", "compute_season_stats", "compute_title_odds",
            "ingest_race_control", "ingest_overtakes", "ingest_team_radio", "ingest_stints", "ingest_pit_stops",
            "ingest_race_control_sprint", "ingest_overtakes_sprint", "ingest_team_radio_sprint",
            "ingest_stints_sprint", "ingest_pit_stops_sprint",
        ]

    def test_lap_times_are_written_by_the_race_ingest(self):
        assert wp.repair_steps("lap_times", "lap_coverage") == wp.repair_steps("race_results", "row_count")

    def test_a_qualifying_repair_rebuilds_the_prediction(self):
        assert [s.name for s in wp.repair_steps("qualifying_results", "q_time_present")] == [
            "ingest_qualifying", "ingest_fp2", "compute_features",
            "compute_title_odds", "ingest_qualifying_telemetry",
        ]

    def test_a_missing_prediction_reruns_the_gp_model(self):
        assert [s.name for s in wp.repair_steps("race_predictions", "prediction_present")] == [
            "compute_features", "compute_title_odds", "ingest_qualifying_telemetry",
        ]

    def test_a_sprint_results_repair_reruns_the_sprint_race_chain(self):
        assert [s.name for s in wp.repair_steps("sprint_results", "row_count")] == [
            "ingest_sprint", "compute_season_stats", "compute_title_odds",
        ]

    def test_season_stats_repair_refreshes_title_odds_too(self):
        assert [s.name for s in wp.repair_steps("driver_season_stats", "driver_presence")] == [
            "compute_season_stats", "compute_title_odds",
        ]

    def test_fp2_coverage_and_unknown_checks_have_no_repair_path(self):
        assert wp.repair_steps("fp2_long_run_times", "driver_coverage") == ()
        assert wp.repair_steps("weird", "x") == ()


class TestRepairPlan:
    def test_checks_in_one_chain_run_it_once_from_the_earliest_owner(self):
        plan = wp.repair_plan([("race_predictions", "prediction_present"), ("driver_prediction_features", "feature_rows")])
        assert [s.name for s in plan] == [
            "compute_features", "compute_title_odds", "ingest_qualifying_telemetry",
        ]

    def test_checks_in_several_chains_run_them_in_weekend_order(self):
        plan = wp.repair_plan([("race_results", "winner_present"), ("qualifying_results", "row_count")])
        names = [s.name for s in plan]
        assert names[:5] == [
            "ingest_qualifying", "ingest_fp2", "compute_features",
            "compute_title_odds", "ingest_qualifying_telemetry",
        ]
        assert names[5:8] == ["ingest_race", "compute_season_stats", "compute_title_odds"]

    def test_checks_without_a_repair_path_add_nothing(self):
        assert wp.repair_plan([("fp2_long_run_times", "driver_coverage")]) == ()


class TestPredictionSteps:
    def test_a_sprint_weekend_rebuilds_both_predictions_once_each(self):
        assert [s.name for s in wp.prediction_steps(is_sprint=True)] == [
            "compute_sprint_features",
            "ingest_fp2", "compute_features",
        ]

    def test_a_conventional_weekend_rebuilds_the_gp_prediction(self):
        assert [s.name for s in wp.prediction_steps(is_sprint=False)] == [
            "ingest_fp2", "compute_features",
        ]


class TestStatusesAfter:
    def test_an_ingest_has_run_once_the_weekend_reaches_the_status_it_commits(self):
        assert wp.statuses_after("ingest_race") == ("completed",)
        assert wp.statuses_after("ingest_qualifying") == ("qualifying_done", "completed")
        assert wp.statuses_after("ingest_sprint_qualifying") == (
            "sprint_qualifying_done", "sprint_done", "qualifying_done", "completed",
        )
