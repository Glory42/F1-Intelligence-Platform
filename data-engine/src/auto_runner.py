from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import pandas as pd
import fastf1
import requests
from src.db.client import get_conn
from src.enrichment_coverage import missing, read_coverage
from src.jobs import sync_schedule
from src.utils import openf1_client
from src.utils.logging_utils import log_job_failure, log_job_ok
from src.utils.schedule_window import race_weekend_window, RaceWeekendWindow
from src.session_kind import is_sprint_weekend
from src.weekend_pipeline import (
    JOBS, Action, ActionKind, JobStep, RaceRunContext, plan,
)


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
    Opens its own connection: the shared one may have gone stale during a long job run."""
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
    retried, so retry here each wait-cycle while coverage is below 0.7. FP2 now only feeds the
    Friday-pace table (weighted-v4 doesn't read it), so predictions aren't recomputed after it.
    Returns whether coverage has reached the gate."""
    before = _fp2_coverage(conn, ctx.race_id)
    if before >= 0.7:
        return True
    log_func(f"[auto_runner] FP2 coverage {before:.0%}, retrying FP2 while waiting for race")
    try:
        JOBS["ingest_fp2"](ctx)
        after = _fp2_coverage(conn, ctx.race_id)
        if after > before:
            log_func(f"[auto_runner] FP2 backfilled ({before:.0%} -> {after:.0%})")
        else:
            log_func(f"[auto_runner] FP2 still not available ({after:.0%}); will retry next cycle")
        return after >= 0.7
    except requests.RequestException as e:
        log_func(f"[auto_runner] FP2 not ready yet: {e}")
        return False


def _retry_missing_race_events(
    log_func: Callable[[str], None], conn: Any, round_number: int, year: int, memo: Optional["WorkerMemo"] = None,
) -> bool:
    """Safety net for the chains' optional steps (see JobStep.run), re-checked every
    cycle inside the window's race-weekend window (up to 24h after the race). Each coverage
    (enrichment_coverage) is checked on its own and only its job reruns. A job that has finished cleanly once is settled
    in the memo even if it wrote nothing (a sprint with no stops, a feed with gaps), so a
    legitimately empty table never keeps the worker opening Neon every cycle.

    Returns False when anything still needs another pass, so the caller keeps re-checking."""
    rows = read_coverage(conn, year, year, round_number)
    if not rows:
        return True

    ctx = RaceRunContext(race_id=rows[0]["id"], year=year, round_number=round_number)
    settled = memo.settled if memo is not None else set()
    pending = [c.job for c in missing(rows[0]) if (ctx.race_id, c.job) not in settled]
    for name in pending:
        log_func(f"[auto_runner] Race {ctx.race_id} is missing {name} data: retrying")
        if JobStep(name, optional=True).run(ctx):
            settled.add((ctx.race_id, name))
    return all((ctx.race_id, name) in settled for name in pending)


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
    # (race_id, step name) that finished cleanly in _retry_missing_race_events.
    settled: set[tuple[int, str]] = field(default_factory=set)


def _quiet_action(memo: Optional[WorkerMemo], schedule: "pd.DataFrame", now_utc: datetime) -> Optional[Action]:
    if memo is None or memo.tracked is None:
        return None
    events = schedule[schedule["RoundNumber"] == memo.tracked.ctx.round_number]
    if events.empty:
        return None
    action = plan(memo.tracked.status, memo.tracked.is_sprint, events.iloc[0], now_utc)
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
        # query below (or superseded by the next round already being 'scheduled'): check it
        # directly on every cycle we're still inside its window (up to 24h post-race-start).
        race_events_settled = True
        if window is not None:
            race_events_settled = _retry_missing_race_events(log_func, conn, window.round_number, now_utc.year, memo)

        with conn.cursor() as cur:
            # Find the most recent active race
            cur.execute(
                """
                SELECT r.id, r.round_number, s.year, r.status, r.event_format, r.name
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
        is_sprint = is_sprint_weekend(race_row["event_format"])

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

        # Jobs look sessions up by round number, so a calendar change (an event added or
        # dropped earlier in the season) would make them ingest a different event's sessions.
        stored_name, schedule_name = race_row.get("name"), event.get("EventName")
        if stored_name and schedule_name and stored_name != schedule_name:
            log_func(
                f"[auto_runner] Round {ctx.round_number} is {schedule_name} in FastF1 but {stored_name} "
                f"in the database: re-syncing the {ctx.year} calendar."
            )
            sync_schedule.run(ctx.year, schedule=schedule)
            return CycleResult(window=window, schedule_available=schedule_available)

        try:
            action = plan(status=status, is_sprint=is_sprint, event=event, now=now_utc)

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

        except (ValueError, RuntimeError, requests.RequestException) as e:
            log_func(f"[auto_runner] Session data not published yet. Will try again next cycle. Details: {e}")
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
