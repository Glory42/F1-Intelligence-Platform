import argparse
import importlib
import sys
from datetime import date

import src.config as _config  # triggers FastF1 cache setup
from src.utils.logging_utils import log_job_failure

# OpenF1 enrichment jobs share one CLI shape: --year/--round (or latest completed race) + --session.
_OPENF1_JOBS = ("ingest_race_control", "ingest_overtakes", "ingest_team_radio", "ingest_stints", "ingest_pit_stops")


def auto_detect_race(year: int | None, conn) -> tuple[int, int]:
    """Uses qualifying_date (FastF1 Session4DateUtc) so it works for every schedule
    variant; falls back to race_date - 1 for legacy rows predating that column."""
    from src.db.client import get_conn
    conn = conn or get_conn()
    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.round_number, s.year FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE COALESCE(r.qualifying_date::date, r.race_date::date - 1) <= %s
              AND r.status NOT IN ('qualifying_done', 'completed')
              AND (%s IS NULL OR s.year = %s)
            ORDER BY r.race_date DESC
            LIMIT 1
            """,
            (today, year, year),
        )
        row = cur.fetchone()
    if not row:
        print("[auto-detect] No upcoming race found", file=sys.stderr)
        sys.exit(1)
    return int(row["year"]), int(row["round_number"])


def auto_detect_sprint_qualifying(year: int | None) -> tuple[int, int]:
    """
    Find the most recent sprint weekend whose sprint qualifying date is today or
    earlier and that is still 'scheduled' (SQ not yet ingested).
    """
    from src.db.client import get_conn
    conn = get_conn()
    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.round_number, s.year FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE r.sprint_qualifying_date::date <= %s
              AND r.status = 'scheduled'
              AND r.sprint_qualifying_date IS NOT NULL
              AND (%s IS NULL OR s.year = %s)
            ORDER BY r.race_date DESC
            LIMIT 1
            """,
            (today, year, year),
        )
        row = cur.fetchone()
    if not row:
        print("[auto-detect-sprint-qualifying] No upcoming SQ round found", file=sys.stderr)
        sys.exit(1)
    conn.close()
    return int(row["year"]), int(row["round_number"])


def auto_detect_sprint(year: int | None) -> tuple[int, int]:
    """
    Find the most recent sprint weekend whose sprint race date is today or earlier
    and that is in 'sprint_qualifying_done' status (SQ done, sprint race not yet ingested).
    """
    from src.db.client import get_conn
    conn = get_conn()
    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.round_number, s.year FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE r.sprint_date::date <= %s
              AND r.status = 'sprint_qualifying_done'
              AND r.sprint_date IS NOT NULL
              AND (%s IS NULL OR s.year = %s)
            ORDER BY r.race_date DESC
            LIMIT 1
            """,
            (today, year, year),
        )
        row = cur.fetchone()
    if not row:
        print("[auto-detect-sprint] No sprint race ready to ingest", file=sys.stderr)
        sys.exit(1)
    conn.close()
    return int(row["year"]), int(row["round_number"])


def auto_detect_completed_race(year: int | None, conn) -> tuple[int, int]:
    """Finds the most recent 'completed' race — for post-race-only jobs (e.g.
    ingest_race_control) that must run after ingest_race, unlike auto_detect_race which
    explicitly excludes completed races."""
    from src.db.client import get_conn
    conn = conn or get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.round_number, s.year FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE r.status = 'completed'
              AND (%s IS NULL OR s.year = %s)
            ORDER BY r.race_date DESC
            LIMIT 1
            """,
            (year, year),
        )
        row = cur.fetchone()
    if not row:
        print("[auto-detect-completed-race] No completed race found", file=sys.stderr)
        sys.exit(1)
    return int(row["year"]), int(row["round_number"])


def _dispatch(job: str, args) -> None:
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

    elif job == "ingest_fp2":
        from src.db.client import get_conn
        conn = get_conn()
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_race(args.year, conn)
        conn.close()
        from src.jobs.ingest_fp2 import run
        run(year, round_num)

    elif job == "ingest_qualifying":
        from src.db.client import get_conn
        conn = get_conn()
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_race(args.year, conn)
        conn.close()
        from src.jobs.ingest_qualifying import run
        run(year, round_num)

    elif job == "ingest_sprint_qualifying":
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_sprint_qualifying(args.year)
        from src.jobs.ingest_sprint_qualifying import run
        run(year, round_num)

    elif job == "ingest_sprint":
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_sprint(args.year)
        from src.jobs.ingest_sprint import run
        run(year, round_num)

    elif job == "ingest_race":
        from src.db.client import get_conn
        conn = get_conn()
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_race(args.year, conn)
        conn.close()
        from src.jobs.ingest_race import run
        run(year, round_num)

    elif job == "ingest_qualifying_telemetry":
        from src.db.client import get_conn
        conn = get_conn()
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_completed_race(args.year, conn)
        conn.close()
        from src.jobs.ingest_qualifying_telemetry import run
        run(year, round_num, session_type="SQ" if args.session == "Sprint" else "Q")

    elif job in _OPENF1_JOBS:
        from src.db.client import get_conn
        conn = get_conn()
        year, round_num = (args.year, args.round_num) if args.year and args.round_num \
            else auto_detect_completed_race(args.year, conn)
        conn.close()
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

    elif job == "compute_predictions":
        if not args.race_id:
            print("--race_id required for compute_predictions", file=sys.stderr)
            sys.exit(1)
        from src.jobs.compute_predictions import run
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
        "ingest_qualifying",
        "ingest_fp2",
        "ingest_sprint_qualifying",
        "ingest_sprint",
        "ingest_race",
        *_OPENF1_JOBS,
        "ingest_qualifying_telemetry",
        "compute_season_stats",
        "compute_title_odds",
        "compute_sprint_features",
        "compute_sprint_predictions",
        "compute_features",
        "compute_predictions",
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
        help="OpenF1 enrichment jobs (ingest_race_control, ingest_stints, ...): which session to pull",
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
