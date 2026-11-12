"""Fills driver_prediction_features.podium_probability for stored GP predictions from their stored win
probabilities: no refit, the numbers compute_features would write. Writes to Neon: local only, checks
storage_guard first. Afterwards bump SNAPSHOT_VERSION (docs/deployment.md) so the API stops serving old copies.
Usage: python scripts/backfill_podium_probability.py [--refresh]"""
import argparse
import sys

from psycopg2.extras import execute_batch

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.utils.finishing_order import podium_updates
from src.utils.storage_guard import read_storage_tier


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="recompute rows that already have one")
    args = parser.parse_args()

    conn = get_conn()
    try:
        if not read_storage_tier(conn).allows_backfill:
            raise SystemExit("storage_guard: Neon storage too full for a backfill")
        with conn.cursor() as cur:
            # Whole fields only: a driver's chance depends on everyone else's in the same race.
            cur.execute(
                "SELECT race_id, driver_id, win_probability, predicted_position FROM driver_prediction_features "
                "WHERE %s OR race_id IN (SELECT race_id FROM driver_prediction_features WHERE podium_probability IS NULL)",
                (args.refresh,),
            )
            stored = cur.fetchall()
        updates = podium_updates(stored)
        with conn.cursor() as cur:
            execute_batch(
                cur,
                "UPDATE driver_prediction_features SET podium_probability = %s WHERE race_id = %s AND driver_id = %s",
                updates,
                page_size=500,
            )
        conn.commit()
    finally:
        conn.close()
    print(f"podium_probability written for {len(updates)} drivers in {len({u[1] for u in updates})} races")


if __name__ == "__main__":
    main()
