"""sprint-v3: weighted-v4's committed GP weights applied to the sprint's own grid and SQ pace
(gp_features_v4.sprint_features), written with the predicted sprint winner in one transaction.
scripts/backtest_sprint.py chose it: refitting on sprints didn't beat it, and the hand-weighted sprint-v2
scored 1.2 log loss per sprint worse (ADR 0014)."""
from typing import Any

from src.db.client import get_conn
from src.jobs.compute_features import model_rows, store_prediction
from src.utils.gp_features_v4 import sprint_features
from src.utils.gp_model_v4 import DriverPrediction, history_start, load_committed, predict
from src.utils.race_history import load_history

SPRINT_MODEL_VERSION = "sprint-v3"


def write_prediction(conn: Any, race_id: int, predictions: list[DriverPrediction]) -> None:
    store_prediction(conn, race_id, model_rows(race_id, predictions),
                     ("driver_sprint_features", "sprint_predictions"), SPRINT_MODEL_VERSION)


def run(race_id: int) -> None:
    print(f"[compute_sprint_features] race_id={race_id}")
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
            # The committed weights saw this weekend's GP and later ones: the stored out-of-sample Prediction stays.
            print(f"  [SKIP] race {race_id} is inside the committed fit (trained to {committed.trained_to}): "
                  f"run scripts/backfill_all_predictions.py --from {race['year']} to rebuild it out-of-sample")
            return
        history = load_history(conn, since=history_start(race["year"]), until=race["race_date"])
        predictions = predict(history, race_id, committed.model, sprint_features)
        write_prediction(conn, race_id, predictions)
        top = predictions[0]
        print(f"  {len(predictions)} drivers ({SPRINT_MODEL_VERSION}); predicted sprint winner "
              f"driver_id={top.driver_id} (p={top.probability:.3f})")
    finally:
        conn.close()
