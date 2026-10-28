"""The only interpreter of Race Status: which job chain a weekend's status calls for, when that
chain is ready to run, and which steps rebuild or repair what a chain wrote."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Iterable, Optional

import pandas as pd

from src.jobs import (
    compute_features,
    compute_season_stats,
    compute_sprint_features,
    compute_title_odds,
    ingest_fp2,
    ingest_overtakes,
    ingest_pit_stops,
    ingest_qualifying,
    ingest_qualifying_telemetry,
    ingest_race,
    ingest_race_control,
    ingest_race_story,
    ingest_sprint,
    ingest_sprint_qualifying,
    ingest_stints,
    ingest_team_radio,
)
from src.enrichment_coverage import SESSIONS, coverage_of, step_name
from src.session_kind import SPRINT_FORMATS, is_sprint_weekend  # noqa: F401 (re-exported)
from src.utils.logging_utils import log_job_failure

WEEKEND_STATUSES = ("scheduled", "sprint_qualifying_done", "sprint_done", "qualifying_done", "completed")


class ActionKind(str, Enum):
    SPRINT_QUALIFYING = "sprint_qualifying"
    SPRINT_RACE = "sprint_race"
    MAIN_QUALIFYING = "main_qualifying"
    MAIN_RACE = "main_race"


@dataclass(frozen=True)
class Stage:
    label: str
    session_column: str
    ready_delay: timedelta
    races_date_sql: str


STAGES: dict[ActionKind, Stage] = {
    ActionKind.SPRINT_QUALIFYING: Stage(
        "Sprint Qualifying", "Session2DateUtc", timedelta(hours=1.5), "r.sprint_qualifying_date::date"),
    ActionKind.SPRINT_RACE: Stage("Sprint Race", "Session3DateUtc", timedelta(hours=1.5), "r.sprint_date::date"),
    # Rows predating races.qualifying_date fall back to the day before the race.
    ActionKind.MAIN_QUALIFYING: Stage(
        "Main Qualifying", "Session4DateUtc", timedelta(hours=2),
        "COALESCE(r.qualifying_date::date, r.race_date::date - 1)"),
    ActionKind.MAIN_RACE: Stage("Main Race", "Session5DateUtc", timedelta(hours=3), "r.race_date::date"),
}

# (is_sprint, status) -> the chain that status calls for; None matches either weekend format.
_TRANSITIONS: tuple[tuple[Optional[bool], str, ActionKind], ...] = (
    (True, "scheduled", ActionKind.SPRINT_QUALIFYING),
    (True, "sprint_qualifying_done", ActionKind.SPRINT_RACE),
    (True, "sprint_done", ActionKind.MAIN_QUALIFYING),
    (False, "scheduled", ActionKind.MAIN_QUALIFYING),
    (None, "qualifying_done", ActionKind.MAIN_RACE),
)


@dataclass(frozen=True)
class RaceRunContext:
    race_id: int
    year: int
    round_number: int


def _session_job(module: Any, session_name: str) -> Callable[[RaceRunContext], Any]:
    return lambda ctx: module.run(ctx.year, ctx.round_number, session_name=session_name)


# Race Events (OpenF1), each run once per session of a completed weekend.
RACE_EVENT_JOBS = {
    "ingest_race_control": ingest_race_control,
    "ingest_overtakes": ingest_overtakes,
    "ingest_team_radio": ingest_team_radio,
    "ingest_stints": ingest_stints,
    "ingest_pit_stops": ingest_pit_stops,
}

# Every step any chain or coverage retry runs, by name. Job modules are looked up at call time, and tests swap
# entries here rather than patching each job module.
JOBS: dict[str, Callable[[RaceRunContext], Any]] = {
    "ingest_sprint_qualifying": lambda ctx: ingest_sprint_qualifying.run(ctx.year, ctx.round_number),
    "compute_sprint_features": lambda ctx: compute_sprint_features.run(ctx.race_id),
    "ingest_sprint": lambda ctx: ingest_sprint.run(ctx.year, ctx.round_number),
    "compute_season_stats": lambda ctx: compute_season_stats.run(ctx.year),
    "ingest_qualifying": lambda ctx: ingest_qualifying.run(ctx.year, ctx.round_number),
    "ingest_fp2": lambda ctx: ingest_fp2.run(ctx.year, ctx.round_number),
    "compute_features": lambda ctx: compute_features.run(ctx.race_id),
    "ingest_race": lambda ctx: ingest_race.run(ctx.year, ctx.round_number),
    "compute_title_odds": lambda ctx: compute_title_odds.run(ctx.year),
    "ingest_qualifying_telemetry":
        lambda ctx: ingest_qualifying_telemetry.run(ctx.year, ctx.round_number, session_type="Q"),
    "ingest_qualifying_telemetry_sprint":
        lambda ctx: ingest_qualifying_telemetry.run(ctx.year, ctx.round_number, session_type="SQ"),
    **{step_name(name, session_type): _session_job(module, session)
       for name, module in (*RACE_EVENT_JOBS.items(), ("ingest_race_story", ingest_race_story))
       for session_type, session in SESSIONS.items()},
}


@dataclass(frozen=True)
class JobStep:
    name: str
    commits_status: Optional[str] = None
    optional: bool = False

    def run(self, ctx: RaceRunContext) -> bool:
        """An optional step (enrichment, derived analysis) never fails its chain: a failure is
        logged and left for the worker's coverage retry. Returns whether the job finished; a job
        may return False to ask for another pass."""
        if not self.optional:
            JOBS[self.name](ctx)
            return True
        try:
            return JOBS[self.name](ctx) is not False
        except Exception as e:
            log_job_failure(self.name, e, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)
            return False


_TITLE_ODDS = JobStep("compute_title_odds", optional=True)

_CHAINS: dict[ActionKind, tuple[JobStep, ...]] = {
    ActionKind.SPRINT_QUALIFYING: (
        JobStep("ingest_sprint_qualifying", commits_status="sprint_qualifying_done"),
        JobStep("compute_sprint_features"),
        _TITLE_ODDS,
        # Telemetry (~41 OpenF1 requests) outruns one cycle's budget; the coverage retry resumes it.
        JobStep("ingest_qualifying_telemetry_sprint", optional=True),
    ),
    ActionKind.SPRINT_RACE: (
        JobStep("ingest_sprint", commits_status="sprint_done"),
        JobStep("compute_season_stats"),
        _TITLE_ODDS,
    ),
    ActionKind.MAIN_QUALIFYING: (
        JobStep("ingest_qualifying", commits_status="qualifying_done"),
        JobStep("ingest_fp2"),
        JobStep("compute_features"),
        _TITLE_ODDS,
        JobStep("ingest_qualifying_telemetry", optional=True),
    ),
    ActionKind.MAIN_RACE: (
        JobStep("ingest_race", commits_status="completed"),
        JobStep("compute_season_stats"),
        _TITLE_ODDS,
        # Race Events self-skip inside OpenF1's live window and, for the sprint, on a weekend
        # without one: see run_openf1_job.
        *(JobStep(step_name(name, session_type), optional=True)
          for session_type in SESSIONS for name in RACE_EVENT_JOBS),
    ),
}


def chain(kind: ActionKind) -> tuple[JobStep, ...]:
    return _CHAINS[kind]


def followups(kind: ActionKind) -> tuple[JobStep, ...]:
    """The core steps a chain runs once its ingest has committed."""
    return tuple(s for s in _CHAINS[kind][1:] if not s.optional)


def prediction_steps(is_sprint: bool) -> tuple[JobStep, ...]:
    """Rebuilds a weekend's Predictions from sessions already ingested: what each qualifying
    chain runs after its ingest, sprint first."""
    kinds = (ActionKind.SPRINT_QUALIFYING, ActionKind.MAIN_QUALIFYING) if is_sprint else (ActionKind.MAIN_QUALIFYING,)
    return tuple(step for kind in kinds for step in followups(kind))


def _chain_step(job: str) -> str:
    """`job` itself if a chain runs it, else, for a coverage retry step, the ingest it waits on."""
    if any(s.name == job for steps in _CHAINS.values() for s in steps):
        return job
    return coverage_of(job).due_after


def stage_of(job: str) -> Stage:
    """The stage of the first chain, in weekend order, that runs `job` (or the ingest it waits on)."""
    step = _chain_step(job)
    return STAGES[next(kind for kind, steps in _CHAINS.items() if any(s.name == step for s in steps))]


def _from(status: str) -> tuple[str, ...]:
    return WEEKEND_STATUSES[WEEKEND_STATUSES.index(status):]


def statuses_after(ingest: str) -> tuple[str, ...]:
    """Race Statuses a weekend can only be in once `ingest` has run: the one it commits onwards."""
    committed = next(s.commits_status for steps in _CHAINS.values() for s in steps if s.name == ingest)
    return _from(committed)


def due_statuses(job: str) -> tuple[str, ...]:
    """Race Statuses in which `job` has work: where its chain is planned, or, for a step after
    the chain's ingest, the status that ingest committed and every later one."""
    if _chain_step(job) != job:
        return statuses_after(_chain_step(job))
    due: set[str] = set()
    for kind, steps in _CHAINS.items():
        names = [s.name for s in steps]
        if job not in names:
            continue
        if steps[0].commits_status and names.index(job) > 0:
            due.update(_from(steps[0].commits_status))
        else:
            due.update(status for _, status, k in _TRANSITIONS if k == kind)
    return tuple(s for s in WEEKEND_STATUSES if s in due)


# The step that writes each repairable audit check's table: a repair re-runs its chain from there.
_REPAIR_OWNERS: dict[tuple[str, str], str] = {
    ("qualifying_results", "row_count"): "ingest_qualifying",
    ("qualifying_results", "q_time_present"): "ingest_qualifying",
    ("race_results", "row_count"): "ingest_race",
    ("race_results", "points_present"): "ingest_race",
    ("race_results", "winner_present"): "ingest_race",
    ("lap_times", "lap_coverage"): "ingest_race",
    ("lap_times", "lap_time_present"): "ingest_race",
    ("sprint_results", "row_count"): "ingest_sprint",
    ("sprint_lap_times", "lap_coverage"): "ingest_sprint",
    ("driver_prediction_features", "feature_rows"): "compute_features",
    ("race_predictions", "prediction_present"): "compute_features",
    ("driver_season_stats", "driver_presence"): "compute_season_stats",
}


def repair_plan(checks: Iterable[tuple[str, str]]) -> tuple[JobStep, ...]:
    """The steps that heal a race's audit checks: each check's owning step and everything its
    chain runs after it, one pass per chain from its earliest owner, chains in weekend order."""
    owners = {_REPAIR_OWNERS[c] for c in checks if c in _REPAIR_OWNERS}
    healing: list[JobStep] = []
    for steps in _CHAINS.values():
        start = next((i for i, s in enumerate(steps) if s.name in owners), None)
        if start is not None:
            owners -= {s.name for s in steps}
            healing.extend(steps[start:])
    return tuple(healing)


def repair_steps(table: str, check: str) -> tuple[JobStep, ...]:
    """Empty when the check has no repair path."""
    return repair_plan([(table, check)])


@dataclass(frozen=True)
class Action:
    kind: ActionKind
    ready: bool
    label: str
    ready_at: Optional[datetime] = None

    @property
    def steps(self) -> tuple[JobStep, ...]:
        return _CHAINS[self.kind]


def _is_ready(session_date_utc: Any, delay: timedelta, now: datetime) -> tuple[bool, Optional[datetime]]:
    # FastF1 returns timezone-naive pandas Timestamps in UTC; None/NaT collapse to pd.NaT here.
    session_ts = pd.Timestamp(session_date_utc)
    if session_ts is pd.NaT:
        return False, None
    ready_at = session_ts.to_pydatetime().replace(tzinfo=timezone.utc) + delay
    return now >= ready_at, ready_at


def plan(status: str, is_sprint: bool, event: pd.Series, now: datetime) -> Optional[Action]:
    """Pure (no I/O): the next chain a weekend in `status` needs, and whether its session is over."""
    kind = next((k for sprint, s, k in _TRANSITIONS if s == status and sprint in (None, is_sprint)), None)
    if kind is None:
        return None
    stage = STAGES[kind]
    ready, ready_at = _is_ready(event[stage.session_column], stage.ready_delay, now)
    return Action(kind=kind, ready=ready, label=stage.label, ready_at=ready_at)
