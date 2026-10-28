"""Every job the CLI, the worker's chains, Repair and the backfills can run, and how it is called: one entry
per job. main.py validates its arguments from `needs`; weekend_pipeline derives its step table from it."""
import importlib
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Callable, Optional

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
    sync_schedule,
    sync_season,
)
from src.session_kind import RACE, SPRINT, RaceSession


class Needs(Enum):
    YEAR = "year"  # --year
    ROUND = "round"  # --year --round, or the latest round whose status says the job is due
    SESSION = "session"  # ROUND plus --session Race|Sprint
    RACE = "race_id"  # --race_id
    NONE = "none"


@dataclass(frozen=True)
class JobArgs:
    year: Optional[int] = None
    round_number: Optional[int] = None
    race_id: Optional[int] = None
    session: RaceSession = RACE
    all_years: bool = False
    resolve_run: Optional[int] = None


@dataclass(frozen=True)
class Job:
    name: str
    needs: Needs
    # Looks the job module's run up at call time, so a test can swap it.
    run: Callable[[JobArgs], Any]


def _module(name: str) -> Any:
    # data_quality_* import weekend_pipeline, which imports this registry: load them when run.
    return importlib.import_module(f"src.jobs.{name}")


_SESSION_MODULES = {
    "ingest_race_control": ingest_race_control,
    "ingest_overtakes": ingest_overtakes,
    "ingest_team_radio": ingest_team_radio,
    "ingest_stints": ingest_stints,
    "ingest_pit_stops": ingest_pit_stops,
    "ingest_race_story": ingest_race_story,
}
_ROUND_MODULES = {
    "ingest_fp2": ingest_fp2,
    "ingest_qualifying": ingest_qualifying,
    "ingest_sprint_qualifying": ingest_sprint_qualifying,
    "ingest_sprint": ingest_sprint,
    "ingest_race": ingest_race,
}

JOB_LIST: tuple[Job, ...] = (
    Job("sync_schedule", Needs.YEAR, lambda a: sync_schedule.run(a.year)),
    Job("sync_season", Needs.YEAR, lambda a: sync_season.run(a.year, a.round_number or 1)),
    *(Job(name, Needs.ROUND, lambda a, m=module: m.run(a.year, a.round_number))
      for name, module in _ROUND_MODULES.items()),
    *(Job(name, Needs.SESSION, lambda a, m=module: m.run(a.year, a.round_number, session_name=a.session.name))
      for name, module in _SESSION_MODULES.items()),
    Job("ingest_qualifying_telemetry", Needs.SESSION, lambda a: ingest_qualifying_telemetry.run(
        a.year, a.round_number, session_type="SQ" if a.session is SPRINT else "Q")),
    Job("compute_season_stats", Needs.YEAR, lambda a: compute_season_stats.run(a.year)),
    Job("compute_title_odds", Needs.YEAR, lambda a: compute_title_odds.run(a.year)),
    Job("compute_sprint_features", Needs.RACE, lambda a: compute_sprint_features.run(a.race_id)),
    Job("compute_features", Needs.RACE, lambda a: compute_features.run(a.race_id)),
    Job("data_quality_audit", Needs.NONE, lambda a: _module("data_quality_audit").run(
        year=a.year or date.today().year, all_years=a.all_years)),
    Job("data_quality_repair", Needs.NONE, lambda a: _module("data_quality_repair").run(
        year=a.year or date.today().year, resolve_run=a.resolve_run)),
)
JOBS: dict[str, Job] = {job.name: job for job in JOB_LIST}
# Race Events (OpenF1), each run once per session of a completed weekend.
RACE_EVENT_JOBS = ("ingest_race_control", "ingest_overtakes", "ingest_team_radio", "ingest_stints", "ingest_pit_stops")
