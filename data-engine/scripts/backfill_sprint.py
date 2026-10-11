#!/usr/bin/env python3
"""Backfill sprint race data for seasons with sprint weekends: re-sync schedule, then
ingest + compute for every completed sprint round, then re-run season stats."""
import argparse
import sys

sys.path.insert(0, ".")
import src.config as _config  # triggers FastF1 cache + env setup

from src.db.client import get_conn


def get_race_id(conn, year: int, round_num: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id FROM races r JOIN seasons s ON r.season_id = s.id "
            "WHERE s.year = %s AND r.round_number = %s",
            (year, round_num),
        )
        row = cur.fetchone()
    if not row:
        raise ValueError(f"Race not found: year={year} round={round_num}")
    return int(row["id"])


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
              AND r.status IN ('sprint_done', 'qualifying_done', 'completed')
            ORDER BY r.race_date
            """,
            (year,),
        )
        return [(row["round_number"], row["id"]) for row in cur.fetchall()]


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

    # Historical SQ sessions have no classification data, so ingest_sprint's "S"
    # session (GridPosition + Position) is used instead of ingest_sprint_qualifying.
    from src.jobs.compute_sprint_features import run as csf_run
    from src.jobs.compute_sprint_predictions import run as csp_run
    from src.jobs.ingest_sprint import run as sprint_run

    for round_num, race_id in rounds:
        print(f"\n  [{year} R{round_num:02d}] ── ingest sprint ──")
        try:
            sprint_run(year, round_num)
        except Exception as e:
            print(f"    WARN: ingest_sprint failed ({e}), skipping this round")
            continue

        print(f"  [{year} R{round_num:02d}] ── sprint features ──")
        try:
            csf_run(race_id)
        except Exception as e:
            print(f"    WARN: compute_sprint_features failed ({e})")
            continue

        print(f"  [{year} R{round_num:02d}] ── sprint predictions ──")
        try:
            csp_run(race_id)
        except Exception as e:
            print(f"    WARN: compute_sprint_predictions failed ({e})")

        print(f"  [{year} R{round_num:02d}] ── ingest sprint results ──")
        try:
            sprint_run(year, round_num)
        except Exception as e:
            print(f"    WARN: ingest_sprint failed ({e})")

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
