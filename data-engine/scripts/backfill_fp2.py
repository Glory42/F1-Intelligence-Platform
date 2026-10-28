"""Backfills FP2 long-run data for all completed races OpenF1 serves (2023+, ADR 0011).
Failures are logged and skipped: FP2 data availability varies."""
import sys
import time
import psycopg2
import psycopg2.extras

sys.path.insert(0, ".")
from src.config import DATABASE_URL
from src.jobs.ingest_fp2 import run as ingest_fp2
from src.session_kind import OPENF1_FIRST_YEAR


def get_conn():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = True
    return conn


def main():
    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, s.year, r.round_number, r.name
            FROM races r
            JOIN seasons s ON r.season_id = s.id
            WHERE r.status = 'completed'
              AND s.year >= %s
            ORDER BY r.race_date
            """,
            (OPENF1_FIRST_YEAR,),
        )
        races = cur.fetchall()
    conn.close()

    total = len(races)
    print(f"FP2 backfill: {total} races ({OPENF1_FIRST_YEAR}+)")
    errors = []

    for i, race in enumerate(races, 1):
        t0 = time.time()
        try:
            ingest_fp2(race["year"], race["round_number"])
            elapsed = time.time() - t0
            print(f"  [{i}/{total}] {race['year']} R{race['round_number']} {race['name']}: {elapsed:.1f}s")
        except Exception as exc:
            elapsed = time.time() - t0
            print(f"  [{i}/{total}] {race['year']} R{race['round_number']} SKIP ({elapsed:.1f}s): {exc}",
                  file=sys.stderr)
            errors.append((race["year"], race["round_number"], str(exc)))

    print(f"\nDone. {total - len(errors)} succeeded, {len(errors)} skipped.")


if __name__ == "__main__":
    main()
