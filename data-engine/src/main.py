import argparse
import sys
from datetime import date

import src.config as _config  # triggers FastF1 cache setup
from src import weekend_pipeline
from src.db.client import get_conn
from src.enrichment_coverage import step_name
from src.jobs.registry import JOBS, JobArgs, Needs
from src.session_kind import BY_NAME
from src.utils.logging_utils import log_job_failure


def auto_detect_round(job: str, year: int | None) -> tuple[int, int]:
    """The latest round whose session for `job` is today or earlier and whose Race Status says
    `job` has work (weekend_pipeline.due_statuses). Exits 1 when there is none."""
    stage = weekend_pipeline.stage_of(job)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT r.round_number, s.year FROM races r
                JOIN seasons s ON r.season_id = s.id
                WHERE {stage.races_date_sql} <= %s
                  AND r.status = ANY(%s)
                  AND (%s IS NULL OR s.year = %s)
                ORDER BY r.race_date DESC
                LIMIT 1
                """,
                (date.today(), list(weekend_pipeline.due_statuses(job)), year, year),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        print(f"[auto-detect] No round where {job} has work", file=sys.stderr)
        sys.exit(1)
    return int(row["year"]), int(row["round_number"])


def _job_args(job: str, args: argparse.Namespace) -> JobArgs:
    """Checks the arguments the job needs; a round-scoped job without --year/--round runs on the latest
    round whose Race Status says it is due."""
    needs = JOBS[job].needs
    session = BY_NAME[args.session]
    required = {Needs.YEAR: "year", Needs.RACE: "race_id"}.get(needs)
    if required and not getattr(args, required):
        print(f"--{required} required for {job}", file=sys.stderr)
        sys.exit(1)
    year, round_number = args.year, args.round_num
    if needs in (Needs.ROUND, Needs.SESSION) and not (year and round_number):
        year, round_number = auto_detect_round(step_name(job, session.tag) if needs is Needs.SESSION else job, year)
    return JobArgs(year=year, round_number=round_number, race_id=args.race_id, session=session,
                   all_years=args.all, resolve_run=args.resolve_run)


def main() -> None:
    parser = argparse.ArgumentParser(description="F1 Intelligence Data Engine")
    parser.add_argument("--job", required=True, choices=list(JOBS))
    parser.add_argument("--year", type=int, help="Season year (e.g. 2025)")
    parser.add_argument("--round", type=int, dest="round_num", help="Race round number")
    parser.add_argument("--race_id", type=int, help="Race DB id (for feature/prediction jobs)")
    parser.add_argument("--all", action="store_true", help="data_quality_audit: scan every season")
    parser.add_argument("--resolve_run", type=int, help="data_quality_repair: audit run id to act on")
    parser.add_argument(
        "--session", choices=list(BY_NAME), default="Race",
        help="Session enrichment jobs (ingest_race_control, ingest_race_story, ...): which session to pull",
    )
    args = parser.parse_args()

    try:
        JOBS[args.job].run(_job_args(args.job, args))
    except SystemExit:
        raise
    except Exception as e:
        log_job_failure(args.job, e, year=args.year, round=args.round_num, race_id=args.race_id)
        sys.exit(1)


if __name__ == "__main__":
    main()
