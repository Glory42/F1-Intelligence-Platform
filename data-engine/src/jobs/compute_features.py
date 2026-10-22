"""weighted-v4 GP features: the committed conditional-logit weights (src/models/gp_v4.json) applied to
gp_features_v4, one row per driver. Each feature's value and its contribution to the driver's score are
stored as JSON so the prediction page can show why a driver is favoured."""
from datetime import date, timedelta
from typing import Any

from psycopg2.extras import Json

from src.db.client import get_conn
from src.utils.conditional_logit import LogitModel
from src.utils.gp_features_v4 import gp_features
from src.utils.gp_model_v4 import GP_V4_MODEL_VERSION, load_model
from src.utils.race_history import RaceHistory, load_history
from src.utils.upsert import upsert

# Form looks back up to 40 races and the circuit safety-car rate further: three seasons covers both.
HISTORY_DAYS = 3 * 365


def feature_rows(history: RaceHistory, race_id: int, model: LogitModel) -> list[dict[str, Any]]:
    rows = []
    for driver_id, values in gp_features(history, race_id).items():
        contributions = model.contributions(values)
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "features": Json({
                f: {"value": round(values[f], 5), "contribution": round(contributions[f], 5)} for f in model.features
            }),
            "raw_weighted_score": round(sum(contributions.values()), 6),
            "win_probability": 0.0,
            "predicted_position": None,
        })
    return rows


def history_for(conn: Any, race_id: int) -> RaceHistory:
    with conn.cursor() as cur:
        cur.execute("SELECT race_date FROM races WHERE id = %s", (race_id,))
        race = cur.fetchone()
    if not race:
        raise ValueError(f"Race {race_id} not found")
    race_date: date = race["race_date"]
    return load_history(conn, since=race_date - timedelta(days=HISTORY_DAYS), until=race_date)


def run(race_id: int) -> None:
    print(f"[compute_features] race_id={race_id}")
    model = load_model()
    conn = get_conn()
    try:
        rows = feature_rows(history_for(conn, race_id), race_id, model)
        upsert(conn, "driver_prediction_features", rows, ["race_id", "driver_id"])
        print(f"  Computed features for {len(rows)} drivers ({GP_V4_MODEL_VERSION})")
    finally:
        conn.close()
