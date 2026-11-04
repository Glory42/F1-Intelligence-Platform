"""Replays title odds after every completed round so the title fight chart has its full history.
Rows are tiny (one per contender per round) and the simulation is seeded, so re-running is a no-op.
Usage: python scripts/backfill_title_odds.py 2018 2026"""
import argparse
import sys

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.jobs.compute_title_odds import run


def completed_rounds(start: int, end: int) -> list[tuple[int, int]]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.year, r.round_number FROM races r JOIN seasons s ON r.season_id = s.id
                   WHERE s.year BETWEEN %s AND %s AND r.status = 'completed'
                   ORDER BY s.year, r.round_number""",
                (start, end),
            )
            return [(row["year"], row["round_number"]) for row in cur.fetchall()]
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("start", type=int, nargs="?", default=2018)
    parser.add_argument("end", type=int, nargs="?", default=2026)
    args = parser.parse_args()
    rounds = completed_rounds(args.start, args.end)
    print(f"Replaying title odds after {len(rounds)} rounds ({args.start}-{args.end})")
    for year, round_number in rounds:
        run(year, after_round=round_number)
