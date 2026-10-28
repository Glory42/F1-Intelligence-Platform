"""weighted-v4 GP Prediction for one race: the committed fit applied to gp_features_v4, written as one
transaction (each driver's feature values and contributions, win probability and rank, and the predicted
winner), so a reader never sees features without probabilities or a field with a dropped driver in it."""
from datetime import datetime, timezone
from typing import Any

from psycopg2.extras import Json

from src.db.client import get_conn
from src.utils.gp_model_v4 import GP_V4_MODEL_VERSION, DriverPrediction, history_start, load_committed, predict
from src.utils.race_history import load_history
from src.utils.upsert import upsert


def prediction_rows(race_id: int, predictions: list[DriverPrediction]) -> list[dict[str, Any]]:
    return [
        {
            "race_id": race_id,
            "driver_id": p.driver_id,
            "features": Json({
                f: {"value": round(p.values[f], 5), "contribution": round(p.contributions[f], 5)} for f in p.values
            }),
            "raw_weighted_score": round(p.score, 6),
            "win_probability": round(p.probability, 5),
            "predicted_position": p.position,
        }
        for p in predictions
    ]


def write_prediction(conn: Any, race_id: int, predictions: list[DriverPrediction]) -> None:
    upsert(conn, "driver_prediction_features", prediction_rows(race_id, predictions), ["race_id", "driver_id"],
           commit=False)
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM driver_prediction_features WHERE race_id = %s AND NOT (driver_id = ANY(%s))",
            (race_id, [p.driver_id for p in predictions]),
        )
    upsert(conn, "race_predictions", [{
        "race_id": race_id,
        "predicted_winner_id": predictions[0].driver_id,
        "computed_at": datetime.now(timezone.utc),
        "model_version": GP_V4_MODEL_VERSION,
    }], ["race_id"], commit=False)
    conn.commit()


def run(race_id: int) -> None:
    print(f"[compute_features] race_id={race_id}")
    committed = load_committed()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT race_date, EXTRACT(YEAR FROM race_date)::int AS year FROM races WHERE id = %s",
                        (race_id,))
            race = cur.fetchone()
        if not race:
            raise ValueError(f"Race {race_id} not found")
        if committed.is_in_sample(race["race_date"]):
            # The committed weights saw this race's result: the stored out-of-sample Prediction stays.
            print(f"  [SKIP] race {race_id} is inside the committed fit (trained to {committed.trained_to}): "
                  f"run scripts/backfill_all_predictions.py --from {race['year']} to rebuild it out-of-sample")
            return
        history = load_history(conn, since=history_start(race["year"]), until=race["race_date"])
        predictions = predict(history, race_id, committed.model)
        write_prediction(conn, race_id, predictions)
        top = predictions[0]
        print(f"  {len(predictions)} drivers ({GP_V4_MODEL_VERSION}); predicted winner driver_id={top.driver_id} "
              f"(p={top.probability:.3f})")
    finally:
        conn.close()
