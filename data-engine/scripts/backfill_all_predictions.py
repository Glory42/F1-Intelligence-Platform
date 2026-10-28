"""Regenerates every stored prediction from --from on. Writes to Neon: local only, checks storage_guard first.

GP (weighted-v4): history is read from Neon once, then each season is predicted with weights fitted only on
the seasons before it, so the scorecard and calibration pages stay out-of-sample. Races still to come are
left to the live job, which uses the committed fit (src/models/gp_v4.json).
Sprint (sprint-v2): recomputed race by race as before.
Usage: python scripts/backfill_all_predictions.py [--from 2018] [--skip-sprint]"""
import argparse
import datetime
import sys
import time

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.jobs import compute_features, compute_sprint_features, compute_sprint_predictions
from src.utils.gp_model_v4 import TRAIN_FROM_YEAR, fit, history_start, load_committed, predict, training_races
from src.utils.race_history import load_history
from src.utils.storage_guard import read_storage_tier


def backfill_gp(start_year: int) -> list[tuple[int, str]]:
    conn = get_conn()
    try:
        if not read_storage_tier(conn).allows_backfill:
            raise SystemExit("storage_guard: Neon storage too full for a backfill")
        history = load_history(conn, since=history_start(TRAIN_FROM_YEAR))
    finally:
        conn.close()

    l2 = load_committed().l2
    training = training_races(history)
    targets = sorted(
        (r for r in history.races.values()
         if r["year"] >= start_year and r["status"] in ("qualifying_done", "completed") and history.quali.get(r["id"])),
        key=lambda r: r["race_date"],
    )
    errors = []
    for year in sorted({r["year"] for r in targets}):
        model = fit(training, before=datetime.date(year, 1, 1), l2=l2)
        season = [r for r in targets if r["year"] == year]
        print(f"── {year}: {len(season)} GP predictions, weights fitted on races before {year}")
        for race in season:
            t0 = time.time()
            try:
                conn = get_conn()
                try:
                    compute_features.write_prediction(conn, race["id"], predict(history, race["id"], model))
                finally:
                    conn.close()
                print(f"  race {race['id']} done in {time.time() - t0:.1f}s")
            except Exception as exc:
                print(f"  race {race['id']} FAILED: {exc}", file=sys.stderr)
                errors.append((race["id"], str(exc)))
    return errors


def backfill_sprint() -> list[tuple[int, str]]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT race_id FROM sprint_results ORDER BY race_id")
            race_ids = [r["race_id"] for r in cur.fetchall()]
    finally:
        conn.close()

    errors = []
    print(f"── Sprint predictions (sprint-v2): {len(race_ids)} races")
    for race_id in race_ids:
        try:
            compute_sprint_features.run(race_id)
            compute_sprint_predictions.run(race_id)
        except Exception as exc:
            print(f"  sprint race {race_id} FAILED: {exc}", file=sys.stderr)
            errors.append((race_id, str(exc)))
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", type=int, default=2018)
    parser.add_argument("--skip-sprint", action="store_true")
    args = parser.parse_args()

    gp_errors = backfill_gp(args.start)
    sprint_errors = [] if args.skip_sprint else backfill_sprint()

    print(f"\nDone. {len(gp_errors)} GP and {len(sprint_errors)} sprint failures.")
    if gp_errors:
        print(f"GP failures:     {[r for r, _ in gp_errors]}")
    if sprint_errors:
        print(f"Sprint failures: {[r for r, _ in sprint_errors]}")


if __name__ == "__main__":
    main()
