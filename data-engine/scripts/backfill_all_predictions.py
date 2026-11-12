"""Regenerates every stored prediction from --from on. Writes to Neon: local only, checks storage_guard first.

History is read from Neon once. Each season is predicted with weights fitted only on the seasons before it, so
the scorecard and calibration pages stay out-of-sample: its GPs (weighted-v4), its sprints (sprint-v3, the same
weights on the sprint grid) and its forecasts before qualifying (pre-quali-v1, fitted on its own features). Races
still to come are left to the live jobs, which use the committed fits (src/models/). Afterwards bump
SNAPSHOT_VERSION in apps/api/wrangler.toml.
Usage: python scripts/backfill_all_predictions.py [--from 2018] [--skip-gp] [--skip-sprint] [--skip-pre-quali]"""
import argparse
import datetime
import sys
import time
from typing import Any, Callable

sys.path.insert(0, ".")

from src.db.client import get_conn
from src.jobs import compute_features, compute_pre_quali, compute_sprint_features
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import PRE_QUALI_FEATURES, pre_quali_features, previous_lineup, sprint_features
from src.utils.gp_model_v4 import TRAIN_FROM_YEAR, fit, history_start, load_committed, predict, training_races
from src.utils.race_history import RaceHistory, load_history
from src.utils.storage_guard import read_storage_tier

Models = dict[str, LogitModel]  # "gp" (weighted-v4 weights, also sprint-v3's) and "pre-quali"
Writer = Callable[[Any, int, Models], None]
Target = tuple[str, int, Writer]


def _write_gp(history: RaceHistory) -> Writer:
    return lambda conn, race_id, m: compute_features.write_prediction(conn, race_id, predict(history, race_id, m["gp"]))


def _write_sprint(history: RaceHistory) -> Writer:
    return lambda conn, race_id, m: compute_sprint_features.write_prediction(
        conn, race_id, predict(history, race_id, m["gp"], sprint_features))


def _write_pre_quali(history: RaceHistory) -> Writer:
    return lambda conn, race_id, m: compute_pre_quali.write_forecast(
        conn, race_id, predict(history, race_id, m["pre-quali"], pre_quali_features))


def _has_lineup(history: RaceHistory, race_id: int) -> bool:
    try:
        previous_lineup(history, race_id)
        return True
    except ValueError:
        return False


def targets(history: RaceHistory, start_year: int, gp: bool, sprint: bool, pre_quali: bool) -> dict[int, list[Target]]:
    """year → (kind, race id, writer) for every GP with a qualifying sheet, every sprint with a grid and every
    decided race with an earlier race that season to take a lineup from."""
    by_year: dict[int, list[Target]] = {}
    for race in sorted(history.races.values(), key=lambda r: r["race_date"]):
        if race["year"] < start_year:
            continue
        if gp and race["status"] in ("qualifying_done", "completed") and history.quali.get(race["id"]):
            by_year.setdefault(race["year"], []).append(("GP", race["id"], _write_gp(history)))
        if sprint and history.sprint_grid.get(race["id"]):
            by_year.setdefault(race["year"], []).append(("sprint", race["id"], _write_sprint(history)))
        if pre_quali and race["status"] in ("qualifying_done", "completed") and _has_lineup(history, race["id"]):
            by_year.setdefault(race["year"], []).append(("pre-quali", race["id"], _write_pre_quali(history)))
    return by_year


def backfill(start_year: int, gp: bool, sprint: bool, pre_quali: bool) -> list[tuple[str, int, str]]:
    conn = get_conn()
    try:
        if not read_storage_tier(conn).allows_backfill:
            raise SystemExit("storage_guard: Neon storage too full for a backfill")
        history = load_history(conn, since=history_start(TRAIN_FROM_YEAR))
    finally:
        conn.close()

    l2 = load_committed().l2
    training = training_races(history)
    errors = []
    for year, season in sorted(targets(history, start_year, gp, sprint, pre_quali).items()):
        before = datetime.date(year, 1, 1)
        models = {
            "gp": fit(training, before=before, l2=l2),
            "pre-quali": fit(training, before=before, features=PRE_QUALI_FEATURES, l2=l2),
        }
        print(f"── {year}: {len(season)} predictions, weights fitted on races before {year}")
        for kind, race_id, write in season:
            t0 = time.time()
            try:
                conn = get_conn()
                try:
                    write(conn, race_id, models)
                finally:
                    conn.close()
                print(f"  {kind} race {race_id} done in {time.time() - t0:.1f}s")
            except Exception as exc:
                print(f"  {kind} race {race_id} FAILED: {exc}", file=sys.stderr)
                errors.append((kind, race_id, str(exc)))
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", type=int, default=2018)
    parser.add_argument("--skip-gp", action="store_true")
    parser.add_argument("--skip-sprint", action="store_true")
    parser.add_argument("--skip-pre-quali", action="store_true")
    args = parser.parse_args()

    errors = backfill(args.start, gp=not args.skip_gp, sprint=not args.skip_sprint, pre_quali=not args.skip_pre_quali)
    print(f"\nDone. {len(errors)} failures.")
    for kind, race_id, error in errors:
        print(f"  {kind} race {race_id}: {error}")


if __name__ == "__main__":
    main()
