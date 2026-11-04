#!/usr/bin/env python3
"""Backfill sprint race data for seasons with sprint weekends: re-sync schedule, then
ingest + compute for every completed sprint round, then re-run season stats."""
import argparse
import sys

sys.path.insert(0, ".")
import src.config as _config  # triggers FastF1 cache + env setup

from src.db.client import get_conn
from src.weekend_pipeline import ActionKind, RaceRunContext, followups, statuses_after


def get_completed_sprint_rounds(conn, year: int) -> list[tuple[int, int]]:
    """Returns list of (round_number, race_id) for completed sprint rounds."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.round_number, r.id AS race_id
            FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE s.year = %s
              AND r.sprint_date IS NOT NULL
              AND r.status = ANY(%s)
            ORDER BY r.race_date
            """,
            (year, list(statuses_after("ingest_sprint"))),
        )
        return [(row["round_number"], row["race_id"]) for row in cur.fetchall()]


def run_year(year: int) -> None:
    print(f"\n{'='*48}")
    print(f"  SPRINT BACKFILL  {year}")
    print(f"{'='*48}")

    # Step 1: sync schedule to populate sprint dates + event_format
    print(f"\n-> sync_schedule {year}")
    from src.jobs.sync_schedule import run as sync_run
    sync_run(year)

    # Step 2: find completed sprint rounds
    conn = get_conn()
    rounds = get_completed_sprint_rounds(conn, year)
    conn.close()

    if not rounds:
        print(f"  No completed sprint rounds for {year}: nothing to backfill")
        return

    print(f"  Found {len(rounds)} completed sprint rounds: rounds {[r[0] for r in rounds]}")

    # Historical SQ sessions have no classification data, so ingest_sprint's "S" session
    # (GridPosition + Position) stands in for ingest_sprint_qualifying.
    from src.jobs.ingest_sprint import run as sprint_run

    for round_num, race_id in rounds:
        print(f"\n  [{year} R{round_num:02d}] ── ingest sprint ──")
        try:
            sprint_run(year, round_num)
        except Exception as e:
            print(f"    WARN: ingest_sprint failed ({e}), skipping this round")
            continue

        ctx = RaceRunContext(race_id=race_id, year=year, round_number=round_num)
        for step in followups(ActionKind.SPRINT_QUALIFYING):
            print(f"  [{year} R{round_num:02d}] ── {step.name} ──")
            try:
                step.run(ctx)
            except Exception as e:
                print(f"    WARN: {step.name} failed ({e})")
                break

    # Step 4: recompute season stats to include sprint aggregates
    print(f"\n-> compute_season_stats {year}  (includes sprint aggregates)")
    from src.jobs.compute_season_stats import run as css_run
    css_run(year)

    print(f"\n  ✓ {year} sprint backfill complete")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill sprint race data")
    parser.add_argument("--years", nargs="+", type=int, default=[2025, 2026],
                        help="Season years to backfill (default: 2025 2026)")
    args = parser.parse_args()

    for year in args.years:
        run_year(year)

    print(f"\n{'='*48}")
    print("  SPRINT BACKFILL COMPLETE")
    print(f"{'='*48}\n")


if __name__ == "__main__":
    main()
