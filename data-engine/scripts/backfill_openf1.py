"""Backfills one OpenF1 enrichment job for every completed race in a year range. Run locally,
never on Render (512 MB RAM, 5 GB/month outbound). openf1_client paces requests itself.
Usage: python scripts/backfill_openf1.py ingest_stints 2023 2026 [--session Sprint]
Telemetry (~41 requests a race, ~90 s paced): backfill_openf1.py ingest_qualifying_telemetry 2023 2026"""
import argparse
import importlib
import sys

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.main import _OPENF1_JOBS
from src.utils.storage_guard import read_storage_tier


def completed_races(start_year: int, end_year: int, sprint_only: bool) -> list[tuple[int, int]]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.year, r.round_number FROM races r
                   JOIN seasons s ON r.season_id = s.id
                   WHERE s.year BETWEEN %s AND %s AND r.status = 'completed'
                     AND (%s = FALSE OR r.sprint_date IS NOT NULL)
                   ORDER BY s.year, r.round_number""",
                (start_year, end_year, sprint_only),
            )
            return [(row["year"], row["round_number"]) for row in cur.fetchall()]
    finally:
        conn.close()


def storage_allows_backfill() -> bool:
    conn = get_conn()
    try:
        tier = read_storage_tier(conn)
    finally:
        conn.close()
    if not tier.allows_backfill:
        print(f"[STOP] Neon storage tier is {tier.value}: backfills are paused to protect the 1 GB Free limit")
    return tier.allows_backfill


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("job", choices=[*_OPENF1_JOBS, "ingest_qualifying_telemetry"])
    parser.add_argument("start", type=int, nargs="?", default=2023)
    parser.add_argument("end", type=int, nargs="?", default=2026)
    parser.add_argument("--session", choices=["Race", "Sprint"], default="Race")
    args = parser.parse_args()

    run = importlib.import_module(f"src.jobs.{args.job}").run
    races = completed_races(args.start, args.end, sprint_only=args.session == "Sprint")
    print(f"Backfilling {args.job} ({args.session}) for {len(races)} completed races ({args.start}-{args.end})")

    ok, failed = 0, []
    for i, (year, round_num) in enumerate(races, 1):
        if not storage_allows_backfill():
            break
        print(f"[{i}/{len(races)}] {year} R{round_num:02d}")
        try:
            if args.job == "ingest_qualifying_telemetry":
                run(year, round_num, session_type="SQ" if args.session == "Sprint" else "Q")
            else:
                run(year, round_num, session_name=args.session)
            ok += 1
        except Exception as e:
            print(f"  [WARN] {year} R{round_num} failed: {e}")
            failed.append((year, round_num))

    print(f"\nDone: {ok}/{len(races)} succeeded")
    if failed:
        print(f"Failed: {failed}")
