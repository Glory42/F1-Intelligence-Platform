import sys
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any, Callable, Optional

import pandas as pd
import fastf1
from fastf1.core import DataNotLoadedError, InvalidSessionError, NoLapDataError
from src.db.client import get_conn
from src.utils import openf1_client
from src.utils.logging_utils import log_job_failure, log_job_ok
from src.utils.schedule_window import race_weekend_window, RaceWeekendWindow

# Import jobs
from src.jobs import (
    ingest_sprint_qualifying,
    compute_sprint_features,
    compute_sprint_predictions,
    ingest_sprint,
    compute_season_stats,
    ingest_qualifying,
    ingest_fp2,
    compute_features,
    compute_predictions,
    ingest_race,
    ingest_race_control,
    ingest_overtakes,
    ingest_team_radio,
    ingest_stints,
    ingest_pit_stops,
    compute_title_odds,
    ingest_qualifying_telemetry,
)


class ActionKind(str, Enum):
    SPRINT_QUALIFYING = "sprint_qualifying"
    SPRINT_RACE = "sprint_race"
    MAIN_QUALIFYING = "main_qualifying"
    MAIN_RACE = "main_race"


@dataclass(frozen=True)
class RaceRunContext:
    race_id: int
    year: int
    round_number: int


@dataclass(frozen=True)
class JobStep:
    name: str
    run: Callable[[RaceRunContext], None]
    commits_status: Optional[str]


def _run_openf1_step(job_run: Callable[[int, int], None], step_name: str, ctx: RaceRunContext) -> None:
    """Race-event enrichment (OpenF1) rides on the MAIN_RACE sequence but must never fail or
    revert it — these jobs are independently idempotent, so a transient OpenF1 hiccup here is
    safe to just log and leave for a manual re-run rather than treating as a pipeline failure."""
    try:
        job_run(ctx.year, ctx.round_number)
    except Exception as e:
        log_job_failure(step_name, e, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)


def _run_title_odds_step(ctx: RaceRunContext) -> None:
    """Title odds are derived analysis — a failure is logged and must never fail or revert the
    race-weekend sequence that produced the standings/predictions it reads."""
    try:
        compute_title_odds.run(ctx.year)
    except Exception as e:
        log_job_failure("compute_title_odds", e, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)


_TITLE_ODDS_STEP = JobStep("compute_title_odds", _run_title_odds_step, None)


def _telemetry_job(session_type: str) -> Callable[[int, int], None]:
    return lambda y, r: ingest_qualifying_telemetry.run(y, r, session_type=session_type)


# Fastest-lap telemetry needs ~41 OpenF1 requests per session, more than one cycle's budget, so it
# resumes on later cycles via _retry_missing_race_events. SQ self-skips on non-sprint weekends.
_TELEMETRY_STEPS = tuple(
    JobStep(name, lambda ctx, job=_telemetry_job(st), name=name: _run_openf1_step(job, name, ctx), None)
    for name, st in (("ingest_qualifying_telemetry", "Q"), ("ingest_sprint_qualifying_telemetry", "SQ"))
)

_OPENF1_JOB_MODULES = (ingest_race_control, ingest_overtakes, ingest_team_radio, ingest_stints, ingest_pit_stops)


def _openf1_session_jobs(session_name: str) -> list[tuple[str, Callable[[int, int], None]]]:
    """Step name + (year, round) runner for every OpenF1 enrichment job of one session.
    Looks up module.run at call time so a patched job is always the one that runs."""
    suffix = "" if session_name == "Race" else "_sprint"
    return [
        (f"{module.__name__.rsplit('.', 1)[-1]}{suffix}",
         lambda y, r, module=module: module.run(y, r, session_name=session_name))
        for module in _OPENF1_JOB_MODULES
    ]


_ACTION_JOBS: dict[ActionKind, tuple[JobStep, ...]] = {
    ActionKind.SPRINT_QUALIFYING: (
        JobStep(
            "ingest_sprint_qualifying",
            lambda ctx: ingest_sprint_qualifying.run(ctx.year, ctx.round_number),
            "sprint_qualifying_done",
        ),
        JobStep("compute_sprint_features", lambda ctx: compute_sprint_features.run(ctx.race_id), None),
        JobStep("compute_sprint_predictions", lambda ctx: compute_sprint_predictions.run(ctx.race_id), None),
        _TITLE_ODDS_STEP,
    ),
    ActionKind.SPRINT_RACE: (
        JobStep("ingest_sprint", lambda ctx: ingest_sprint.run(ctx.year, ctx.round_number), "sprint_done"),
        JobStep("compute_season_stats", lambda ctx: compute_season_stats.run(ctx.year), None),
        _TITLE_ODDS_STEP,
    ),
    ActionKind.MAIN_QUALIFYING: (
        JobStep("ingest_qualifying", lambda ctx: ingest_qualifying.run(ctx.year, ctx.round_number), "qualifying_done"),
        JobStep("ingest_fp2", lambda ctx: ingest_fp2.run(ctx.year, ctx.round_number), None),
        JobStep("compute_features", lambda ctx: compute_features.run(ctx.race_id), None),
        JobStep("compute_predictions", lambda ctx: compute_predictions.run(ctx.race_id), None),
        _TITLE_ODDS_STEP,
    ),
    ActionKind.MAIN_RACE: (
        JobStep("ingest_race", lambda ctx: ingest_race.run(ctx.year, ctx.round_number), "completed"),
        JobStep("compute_season_stats", lambda ctx: compute_season_stats.run(ctx.year), None),
        _TITLE_ODDS_STEP,
        # Race Events (OpenF1) — 2023+ only, and run_openf1_job self-skips while still inside
        # OpenF1's live-data window; see openf1_client.py. Non-fatal via _run_openf1_step.
        # The Sprint-session steps self-skip too (no-op) on a non-sprint weekend, since
        # races.sprint_date is null there — see run_openf1_job.
        *(JobStep(name, lambda ctx, job=job, name=name: _run_openf1_step(job, name, ctx), None)
          for name, job in _openf1_session_jobs("Race")),
        *(JobStep(name, lambda ctx, job=job, name=name: _run_openf1_step(job, name, ctx), None)
          for name, job in _openf1_session_jobs("Sprint")),
        *_TELEMETRY_STEPS,
    ),
}


@dataclass(frozen=True)
class Action:
    kind: ActionKind
    ready: bool
    label: str
    steps: tuple[JobStep, ...]
    ready_at: Optional[datetime] = None


def _is_ready(session_date_utc: Any, delay_hours: float, now: datetime) -> tuple[bool, Optional[datetime]]:
    # FastF1 returns timezone-naive pandas Timestamps in UTC; None/NaT collapse to pd.NaT here.
    session_ts = pd.Timestamp(session_date_utc)
    if session_ts is pd.NaT:
        return False, None
    session_time = session_ts.to_pydatetime().replace(tzinfo=timezone.utc)
    ready_at = session_time + timedelta(hours=delay_hours)
    return now >= ready_at, ready_at


def decide_next_action(status: str, is_sprint: bool, event: pd.Series, now: datetime) -> Optional[Action]:
    """Pure — no I/O — so it's testable with fake inputs, no FastF1/DB mocking needed."""
    if is_sprint and status == "scheduled":
        ready, ready_at = _is_ready(event["Session2DateUtc"], delay_hours=1.5, now=now)
        return Action(
            kind=ActionKind.SPRINT_QUALIFYING,
            ready=ready,
            label="Sprint Qualifying",
            steps=_ACTION_JOBS[ActionKind.SPRINT_QUALIFYING],
            ready_at=ready_at,
        )

    if is_sprint and status == "sprint_qualifying_done":
        ready, ready_at = _is_ready(event["Session3DateUtc"], delay_hours=1.5, now=now)
        return Action(
            kind=ActionKind.SPRINT_RACE,
            ready=ready,
            label="Sprint Race",
            steps=_ACTION_JOBS[ActionKind.SPRINT_RACE],
            ready_at=ready_at,
        )

    if (not is_sprint and status == "scheduled") or (is_sprint and status == "sprint_done"):
        ready, ready_at = _is_ready(event["Session4DateUtc"], delay_hours=2.0, now=now)
        return Action(
            kind=ActionKind.MAIN_QUALIFYING,
            ready=ready,
            label="Main Qualifying",
            steps=_ACTION_JOBS[ActionKind.MAIN_QUALIFYING],
            ready_at=ready_at,
        )

    if status == "qualifying_done":
        ready, ready_at = _is_ready(event["Session5DateUtc"], delay_hours=3.0, now=now)
        return Action(
            kind=ActionKind.MAIN_RACE,
            ready=ready,
            label="Main Race",
            steps=_ACTION_JOBS[ActionKind.MAIN_RACE],
            ready_at=ready_at,
        )

    return None


@dataclass(frozen=True)
class StepOutcome:
    ok: bool
    last_committed_status: Optional[str]
    failed_step: Optional[str]
    error: Optional[Exception]


def _run_action_steps(action: Action, ctx: RaceRunContext) -> StepOutcome:
    """Tracks how far the sequence got so revert_race_status can avoid clobbering
    progress a later step failed to build on."""
    last_committed_status: Optional[str] = None
    for step in action.steps:
        try:
            step.run(ctx)
        except Exception as e:
            return StepOutcome(ok=False, last_committed_status=last_committed_status, failed_step=step.name, error=e)
        log_job_ok(step.name, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)
        if step.commits_status:
            last_committed_status = step.commits_status
    return StepOutcome(ok=True, last_committed_status=last_committed_status, failed_step=None, error=None)


def revert_race_status(
    conn_factory: Callable[[], Any],
    ctx: RaceRunContext,
    last_committed_status: Optional[str],
    pre_sequence_status: str,
    error: Exception,
    failed_step: str,
) -> None:
    """Reverts to the last status the sequence actually committed, not the pre-sequence value.
    Opens its own connection — the shared one may have gone stale during a long job run."""
    log_job_failure(failed_step, error, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)
    target_status = last_committed_status if last_committed_status is not None else pre_sequence_status
    conn = conn_factory()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE races SET status = %s WHERE id = %s", (target_status, ctx.race_id))
        conn.commit()
    finally:
        conn.close()


def _fp2_coverage(conn, race_id: int) -> float:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(DISTINCT driver_id) AS n FROM fp2_long_run_times "
            "WHERE race_id = %s",
            (race_id,),
        )
        covered = cur.fetchone()["n"]
        cur.execute(
            "SELECT COUNT(*) AS n FROM qualifying_results WHERE race_id = %s",
            (race_id,),
        )
        expected = cur.fetchone()["n"]
    if not expected:
        return 1.0
    return covered / expected


def _backfill_fp2(log_func, conn, ctx: RaceRunContext) -> bool:
    """ingest_fp2 only runs once (at MAIN_QUALIFYING); if data wasn't ready it was never
    retried, so retry here each wait-cycle while coverage is below the 0.7 fallback gate.
    Returns whether coverage has reached the gate."""
    before = _fp2_coverage(conn, ctx.race_id)
    if before >= 0.7:
        return True
    log_func(f"[auto_runner] FP2 coverage {before:.0%} — retrying FP2 + recompute while waiting for race")
    try:
        ingest_fp2.run(ctx.year, ctx.round_number)
        after = _fp2_coverage(conn, ctx.race_id)
        if after > before:
            compute_features.run(ctx.race_id)
            compute_predictions.run(ctx.race_id)
            log_func(f"[auto_runner] FP2 backfilled ({before:.0%} -> {after:.0%}); features/predictions refreshed")
        else:
            log_func(f"[auto_runner] FP2 still not available ({after:.0%}); will retry next cycle")
        return after >= 0.7
    except (DataNotLoadedError, InvalidSessionError, NoLapDataError) as e:
        log_func(f"[auto_runner] FP2 not ready yet: {e}")
        return False


def _retry_missing_race_events(log_func: Callable[[str], None], conn: Any, round_number: int, year: int) -> bool:
    """Safety net for MAIN_RACE's non-fatal OpenF1 steps (see _run_openf1_step): if a race
    completed but OpenF1 genuinely wasn't ready yet (e.g. a red-flag-delayed race pushed the
    real session end past OPENF1_LIVE_WINDOW_BUFFER), that failure is logged and swallowed
    there rather than retried — deliberately, so it never blocks or reverts the core pipeline.
    This re-checks the current window's race every cycle (up to 24h post-race, per
    RaceWeekendWindow's _TAIL) and retries if it's still missing.

    Race control is used as the "did ingestion ever actually succeed" signal because a
    session that happened virtually always has at least one message — unlike team radio,
    which is routinely and legitimately empty, so its absence alone would be a false signal.

    Returns False when a retry was needed, so the caller keeps re-checking next cycle.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r.status, r.sprint_date,
                   EXISTS (SELECT 1 FROM race_control_messages rc
                           WHERE rc.race_id = r.id AND rc.session_type = 'race') AS has_race_control,
                   EXISTS (SELECT 1 FROM race_control_messages rc
                           WHERE rc.race_id = r.id AND rc.session_type = 'sprint') AS has_sprint_race_control,
                   (SELECT count(*) FROM qualifying_lap_telemetry t WHERE t.race_id = r.id AND t.session_type = 'Q')
                     >= (SELECT count(*) FROM qualifying_results q WHERE q.race_id = r.id) AS telemetry_complete
            FROM races r
            JOIN seasons s ON s.id = r.season_id
            WHERE s.year = %s AND r.round_number = %s
            """,
            (year, round_number),
        )
        row = cur.fetchone()

    if row is None or row["status"] != "completed":
        return True
    race_missing = not row["has_race_control"]
    sprint_missing = row["sprint_date"] is not None and not row.get("has_sprint_race_control")
    telemetry_missing = not row.get("telemetry_complete", True)
    if not race_missing and not sprint_missing and not telemetry_missing:
        return True

    ctx = RaceRunContext(race_id=row["id"], year=year, round_number=round_number)
    if race_missing:
        log_func(f"[auto_runner] Race {row['id']} is completed but has no race control data — retrying OpenF1 ingestion")
        for name, job in _openf1_session_jobs("Race"):
            _run_openf1_step(job, name, ctx)
    if sprint_missing:
        log_func(f"[auto_runner] Race {row['id']} has no sprint race control data — retrying sprint OpenF1 ingestion")
        for name, job in _openf1_session_jobs("Sprint"):
            _run_openf1_step(job, name, ctx)
    if telemetry_missing:
        for step in _TELEMETRY_STEPS:
            step.run(ctx)
    return False


ACTIVE_POLL_SECONDS = 20 * 60
IDLE_POLL_SECONDS = 6 * 60 * 60


def _default_schedule_fetcher(now_utc: datetime) -> "pd.DataFrame":
    # FastF1's HTTP cache keeps responses for up to 12h (see fastf1.req._Cache),
    # long enough for a stale session-time revision to block readiness for hours.
    # This fetch is small and infrequent (one poll per ACTIVE_POLL_SECONDS), so
    # always going to the network keeps the race-weekend gate accurate.
    with fastf1.Cache.disabled():
        return fastf1.get_event_schedule(now_utc.year, include_testing=False)


@dataclass(frozen=True)
class TrackedRace:
    ctx: RaceRunContext
    status: str
    is_sprint: bool


@dataclass
class WorkerMemo:
    """Survives between cycles in the long-running worker. The worker is the only writer of
    races.status, so a status it last saw stays true until it runs the next action itself."""

    tracked: Optional[TrackedRace] = None


def _quiet_action(memo: Optional[WorkerMemo], schedule: "pd.DataFrame", now_utc: datetime) -> Optional[Action]:
    if memo is None or memo.tracked is None:
        return None
    events = schedule[schedule["RoundNumber"] == memo.tracked.ctx.round_number]
    if events.empty:
        return None
    action = decide_next_action(memo.tracked.status, memo.tracked.is_sprint, events.iloc[0], now_utc)
    if action is None or action.ready or action.ready_at is None:
        return None
    return action


@dataclass(frozen=True)
class CycleResult:
    window: Optional[RaceWeekendWindow]
    schedule_available: bool


def poll_interval_for_window(
    window: Optional[RaceWeekendWindow],
    now_utc: datetime,
    *,
    schedule_available: bool = True,
) -> int:
    """ACTIVE during a race weekend, or fail-safe when the schedule fetch fails (an outage
    must not go quiet for IDLE_POLL_SECONDS during a live race weekend); IDLE otherwise."""
    if not schedule_available:
        return ACTIVE_POLL_SECONDS
    if window is not None and window.contains(now_utc):
        return ACTIVE_POLL_SECONDS
    return IDLE_POLL_SECONDS


def run_cycle(
    log_func: Callable[[str], None] = print,
    *,
    now_utc: Optional[datetime] = None,
    schedule_provider: Optional[Callable[[], "pd.DataFrame"]] = None,
    conn_factory: Callable[[], Any] = get_conn,
    memo: Optional[WorkerMemo] = None,
) -> CycleResult:
    log_func("[auto_runner] Waking up to check for pending F1 sessions...")
    openf1_client.reset_request_budget()

    now_utc = now_utc if now_utc is not None else datetime.now(timezone.utc)
    fetch = schedule_provider or (lambda: _default_schedule_fetcher(now_utc))

    try:
        schedule = fetch()
        schedule_available = True
    except Exception as e:
        # Fail-safe: a transient FastF1 outage must not skip a live race weekend.
        schedule = None
        schedule_available = False
        log_func(f"[auto_runner] Race-weekend gate schedule fetch failed ({e}); proceeding without the gate.")

    window = race_weekend_window(schedule, now_utc) if schedule is not None else None

    if schedule_available:
        if window is None or not window.contains(now_utc):
            detail = (
                f"next window opens {window.start:%Y-%m-%d %H:%MZ}"
                if window
                else "no upcoming race on the calendar"
            )
            log_func(f"[auto_runner] Outside a race-weekend window ({detail}); skipping the database check.")
            return CycleResult(window=window, schedule_available=True)

        quiet = _quiet_action(memo, schedule, now_utc)
        if quiet is not None:
            log_func(f"[auto_runner] {quiet.label} not ready until {quiet.ready_at:%Y-%m-%d %H:%MZ}; skipping the database check.")
            return CycleResult(window=window, schedule_available=True)

    if memo is not None:
        memo.tracked = None
    conn = conn_factory()
    try:
        # The window's race may already be 'completed' and so invisible to the "active race"
        # query below (or superseded by the next round already being 'scheduled') — check it
        # directly on every cycle we're still inside its window (up to 24h post-race-start).
        race_events_settled = True
        if window is not None:
            race_events_settled = _retry_missing_race_events(log_func, conn, window.round_number, now_utc.year)

        with conn.cursor() as cur:
            # Find the most recent active race
            cur.execute(
                """
                SELECT r.id, r.round_number, s.year, r.status, r.event_format
                FROM races r
                JOIN seasons s ON r.season_id = s.id
                WHERE r.status != 'completed' AND s.year >= EXTRACT(YEAR FROM CURRENT_DATE)
                ORDER BY r.race_date ASC
                LIMIT 1
                """
            )
            race_row = cur.fetchone()

        if not race_row:
            log_func("[auto_runner] No active races found. Exiting.")
            return CycleResult(window=window, schedule_available=schedule_available)

        ctx = RaceRunContext(
            race_id=race_row["id"],
            year=race_row["year"],
            round_number=race_row["round_number"],
        )
        status = race_row["status"]
        is_sprint = race_row["event_format"] in ["sprint", "sprint_qualifying", "sprint_shootout"]

        log_func(f"[auto_runner] Tracking {ctx.year} Round {ctx.round_number} (Status: {status})")

        # Reuse the schedule already fetched for the gate; only re-fetch if that fetch failed.
        if schedule is None:
            try:
                schedule = fetch()
                schedule_available = True
                window = race_weekend_window(schedule, now_utc)
            except Exception as e:
                log_func(f"[auto_runner] Failed to fetch schedule from FastF1: {e}")
                return CycleResult(window=None, schedule_available=False)

        try:
            event = schedule[schedule["RoundNumber"] == ctx.round_number].iloc[0]
        except Exception as e:
            log_func(f"[auto_runner] Failed to fetch schedule from FastF1: {e}")
            return CycleResult(window=window, schedule_available=schedule_available)

        try:
            action = decide_next_action(status=status, is_sprint=is_sprint, event=event, now=now_utc)

            if action is None:
                log_func(f"[auto_runner] Unhandled status '{status}'. Exiting.")
                return CycleResult(window=window, schedule_available=schedule_available)
            if not action.ready:
                fp2_settled = True
                # Opportunistically backfill FP2 (see _backfill_fp2) while waiting for the race.
                if status == "qualifying_done" and action.kind == ActionKind.MAIN_RACE:
                    fp2_settled = _backfill_fp2(log_func, conn, ctx)
                if memo is not None and fp2_settled and race_events_settled:
                    memo.tracked = TrackedRace(ctx=ctx, status=status, is_sprint=is_sprint)
                ready_at_str = f"{action.ready_at:%Y-%m-%d %H:%MZ}" if action.ready_at else "unknown (session time missing from schedule)"
                log_func(
                    f"[auto_runner] {action.label} not finished yet or hasn't reached delay threshold "
                    f"(ready at {ready_at_str}, now {now_utc:%Y-%m-%d %H:%MZ}). Exiting."
                )
                return CycleResult(window=window, schedule_available=schedule_available)
            else:
                log_func(f"[auto_runner] {action.label} time passed. Attempting ingestion...")
                outcome = _run_action_steps(action, ctx)
                if not outcome.ok:
                    log_func(f"[auto_runner] Error during {action.label} sequence: {outcome.error}. Reverting status.")
                    revert_race_status(
                        conn_factory, ctx, outcome.last_committed_status, status, outcome.error, outcome.failed_step
                    )
                    raise outcome.error
                log_func(f"[auto_runner] {action.label} ingestion completed successfully.")
                return CycleResult(window=window, schedule_available=schedule_available)

        except (DataNotLoadedError, InvalidSessionError, NoLapDataError, ValueError, RuntimeError) as e:
            log_func(f"[auto_runner] Data not ready from FastF1 yet. Will try again next hour. Details: {e}")
            return CycleResult(window=window, schedule_available=schedule_available)
        except Exception as e:
            # For unexpected errors, we want to fail so it shows up in Render logs
            log_func(f"[auto_runner] Unexpected error during execution: {e}")
            log_job_failure("auto_runner", e, race_id=ctx.race_id, year=ctx.year, round=ctx.round_number)
            raise
    finally:
        conn.close()

if __name__ == "__main__":
    run_cycle()
