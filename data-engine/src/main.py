import argparse
import importlib
import sys
from datetime import date

import src.config as _config  # triggers FastF1 cache setup
from src import weekend_pipeline
from src.db.client import get_conn
from src.enrichment_coverage import step_name
from src.utils.logging_utils import log_job_failure

# Session ingests take --year/--round, or auto-detect the round whose status says they're due.
_ROUND_JOBS = ("ingest_fp2", "ingest_qualifying", "ingest_sprint_qualifying", "ingest_sprint", "ingest_race")
# Per-session enrichment: --year/--round (or the latest round it is due in) + --session.
_SESSION_JOBS = (*weekend_pipeline.RACE_EVENT_JOBS, "ingest_race_story")


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


def _year_round(args: argparse.Namespace, job: str) -> tuple[int, int]:
    if args.year and args.round_num:
        return args.year, args.round_num
    return auto_detect_round(job, args.year)


def _dispatch(job: str, args: argparse.Namespace) -> None:
    if job == "sync_schedule":
        if not args.year:
            print("--year required for sync_schedule", file=sys.stderr)
            sys.exit(1)
        from src.jobs.sync_schedule import run
        run(args.year)

    elif job == "sync_season":
        if not args.year:
            print("--year required for sync_season", file=sys.stderr)
            sys.exit(1)
        round_num = args.round_num or 1
        from src.jobs.sync_season import run
        run(args.year, round_num)

    elif job in _ROUND_JOBS:
        importlib.import_module(f"src.jobs.{job}").run(*_year_round(args, job))

    elif job == "ingest_qualifying_telemetry":
        from src.jobs.ingest_qualifying_telemetry import run
        sprint = args.session == "Sprint"
        run(*_year_round(args, step_name(job, "sprint" if sprint else "race")), session_type="SQ" if sprint else "Q")

    elif job in _SESSION_JOBS:
        year, round_num = _year_round(args, step_name(job, "sprint" if args.session == "Sprint" else "race"))
        importlib.import_module(f"src.jobs.{job}").run(year, round_num, session_name=args.session)

    elif job == "compute_season_stats":
        if not args.year:
            print("--year required for compute_season_stats", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_season_stats import run
        run(args.year)

    elif job == "compute_title_odds":
        if not args.year:
            print("--year required for compute_title_odds", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_title_odds import run
        run(args.year)

    elif job == "compute_sprint_features":
        if not args.race_id:
            print("--race_id required for compute_sprint_features", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_sprint_features import run
        run(args.race_id)

    elif job == "compute_sprint_predictions":
        if not args.race_id:
            print("--race_id required for compute_sprint_predictions", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_sprint_predictions import run
        run(args.race_id)

    elif job == "compute_features":
        if not args.race_id:
            print("--race_id required for compute_features", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_features import run
        run(args.race_id)

    elif job == "data_quality_audit":
        from src.jobs.data_quality_audit import run
        run(year=(args.year or date.today().year), all_years=args.all)

    elif job == "data_quality_repair":
        from src.jobs.data_quality_repair import run
        run(year=(args.year or date.today().year), resolve_run=args.resolve_run)


def main() -> None:
    parser = argparse.ArgumentParser(description="F1 Intelligence Data Engine")
    parser.add_argument("--job", required=True, choices=[
        "sync_schedule",
        "sync_season",
        *_ROUND_JOBS,
        *_SESSION_JOBS,
        "ingest_qualifying_telemetry",
        "compute_season_stats",
        "compute_title_odds",
        "compute_sprint_features",
        "compute_sprint_predictions",
        "compute_features",
        "data_quality_audit",
        "data_quality_repair",
    ])
    parser.add_argument("--year", type=int, help="Season year (e.g. 2025)")
    parser.add_argument("--round", type=int, dest="round_num", help="Race round number")
    parser.add_argument("--race_id", type=int, help="Race DB id (for feature/prediction jobs)")
    parser.add_argument("--all", action="store_true", help="data_quality_audit: scan every season")
    parser.add_argument("--resolve_run", type=int, help="data_quality_repair: audit run id to act on")
    parser.add_argument(
        "--session", choices=["Race", "Sprint"], default="Race",
        help="Session enrichment jobs (ingest_race_control, ingest_race_story, ...): which session to pull",
    )
    args = parser.parse_args()

    try:
        _dispatch(args.job, args)
    except SystemExit:
        raise
    except Exception as e:
        log_job_failure(args.job, e, year=args.year, round=args.round_num, race_id=args.race_id)
        sys.exit(1)


if __name__ == "__main__":
    main()
