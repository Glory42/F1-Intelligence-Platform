"""pre-quali-v1: the next race's forecast before qualifying, written once the race before it is ingested, so it
stands all week. v4's code with only the features qualifying can't set (gp_features_v4.PRE_QUALI_FEATURES), over the
lineup of the race just run, fitted separately (src/models/gp_v4_prequali.json; ADR 0015). The post-qualifying
Prediction replaces it on the page; it stays stored so the page can show how each driver's chance moved."""
from typing import Any, Optional

from src.db.client import get_conn
from src.jobs.compute_features import model_rows
from src.utils.gp_features_v4 import pre_quali_features
from src.utils.gp_model_v4 import PRE_QUALI_MODEL_VERSION, DriverPrediction, history_start, load_pre_quali, predict
from src.utils.race_history import load_history
from src.utils.upsert import upsert

TABLE = "pre_quali_predictions"


def write_forecast(conn: Any, race_id: int, predictions: list[DriverPrediction]) -> None:
    rows = [{**row, "model_version": PRE_QUALI_MODEL_VERSION} for row in model_rows(race_id, predictions)]
    upsert(conn, TABLE, rows, ["race_id", "driver_id"], commit=False)
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {TABLE} WHERE race_id = %s AND NOT (driver_id = ANY(%s))",
            (race_id, [r["driver_id"] for r in rows]),
        )
    conn.commit()


def _next_race(conn: Any, race_id: int) -> Optional[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT n.id, n.race_date, EXTRACT(YEAR FROM n.race_date)::int AS year "
            "FROM races r JOIN races n ON n.season_id = r.season_id AND n.race_date > r.race_date "
            "WHERE r.id = %s ORDER BY n.race_date LIMIT 1",
            (race_id,),
        )
        return cur.fetchone()


def run(race_id: int) -> None:
    """`race_id` is the race just completed: the forecast is for the one after it."""
    print(f"[compute_pre_quali] after race_id={race_id}")
    committed = load_pre_quali()
    conn = get_conn()
    try:
        target = _next_race(conn, race_id)
        if target is None:
            print("  [SKIP] the season's last race: nothing left to forecast")
            return
        if committed.is_in_sample(target["race_date"]):
            print(f"  [SKIP] race {target['id']} is inside the committed fit (trained to {committed.trained_to}): "
                  f"run scripts/backfill_all_predictions.py --from {target['year']} to rebuild it out-of-sample")
            return
        history = load_history(conn, since=history_start(target["year"]), until=target["race_date"])
        predictions = predict(history, target["id"], committed.model, pre_quali_features)
        write_forecast(conn, target["id"], predictions)
        top = predictions[0]
        print(f"  race {target['id']}: {len(predictions)} drivers ({PRE_QUALI_MODEL_VERSION}); favourite "
              f"driver_id={top.driver_id} (p={top.probability:.3f})")
    finally:
        conn.close()
