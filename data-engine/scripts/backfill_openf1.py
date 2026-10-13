"""Backfills one OpenF1 enrichment job for every completed race OpenF1 serves (2023+) in a year
range, skipping races that already have it unless --refresh (team radio has no coverage check, so
it always reruns). Run locally, never on Render (512 MB RAM, 5 GB/month outbound). openf1_client
paces requests itself.
Usage: python scripts/backfill_openf1.py ingest_stints 2023 2026 [--session Sprint] [--refresh]
Telemetry (~41 requests a race, ~90 s paced): backfill_openf1.py ingest_qualifying_telemetry 2023 2026"""
import argparse
import sys

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.enrichment_coverage import Source, backfill_allowed, read_coverage, source_for, step_name
from src.weekend_pipeline import JOBS, RACE_EVENT_JOBS, RaceRunContext

JOB_CHOICES = (*RACE_EVENT_JOBS, "ingest_qualifying_telemetry")


def races_to_fill(start_year: int, end_year: int, step: str, sprint: bool, refresh: bool) -> list[dict]:
    conn = get_conn()
    try:
        rows = read_coverage(conn, start_year, end_year)
    finally:
        conn.close()
    return [
        r for r in rows
        if r["status"] == "completed" and source_for(r["year"]) is Source.OPENF1
        and (not sprint or r["sprint_date"] is not None) and (refresh or not r.get(step, False))
    ]


def storage_allows_backfill() -> bool:
    conn = get_conn()
    try:
        return backfill_allowed(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("job", choices=JOB_CHOICES)
    parser.add_argument("start", type=int, nargs="?", default=2023)
    parser.add_argument("end", type=int, nargs="?", default=2026)
    parser.add_argument("--session", choices=["Race", "Sprint"], default="Race")
    parser.add_argument("--refresh", action="store_true", help="rerun even where the coverage is already there")
    args = parser.parse_args()

    sprint = args.session == "Sprint"
    step = step_name(args.job, "sprint" if sprint else "race")
    races = races_to_fill(args.start, args.end, step, sprint, args.refresh)
    print(f"Backfilling {args.job} ({args.session}) for {len(races)} completed races ({args.start}-{args.end})")

    ok, failed = 0, []
    for i, race in enumerate(races, 1):
        if not storage_allows_backfill():
            break
        year, round_num = race["year"], race["round_number"]
        print(f"[{i}/{len(races)}] {year} R{round_num:02d}")
        try:
            JOBS[step](RaceRunContext(race_id=race["id"], year=year, round_number=round_num))
            ok += 1
        except Exception as e:
            print(f"  [WARN] {year} R{round_num} failed: {e}")
            failed.append((year, round_num))

    print(f"\nDone: {ok}/{len(races)} succeeded")
    if failed:
        print(f"Failed: {failed}")
