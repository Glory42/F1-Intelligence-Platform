from datetime import datetime, timezone
from psycopg2 import sql
from psycopg2.extras import execute_batch
from src.db.client import get_conn
from src.utils.math_utils import softmax


def rank_by_probability(
    driver_ids: list[int], probabilities: list[float]
) -> tuple[dict[int, int], int]:
    """Rank drivers by win probability, highest first. Returns (driver_id -> position, predicted_winner_id)."""
    sorted_indices = sorted(range(len(probabilities)), key=lambda i: probabilities[i], reverse=True)
    position_map = {driver_ids[sorted_indices[rank]]: rank + 1 for rank in range(len(driver_ids))}
    predicted_winner_id = driver_ids[sorted_indices[0]]
    return position_map, predicted_winner_id


def run_prediction_job(
    race_id: int,
    *,
    job_name: str,
    feature_table: str,
    prediction_table: str,
    model_version: str,
    not_found_error: str,
    winner_label: str,
    temperature: float,
) -> None:
    """`temperature` divides the stored raw scores: a fitted model (weighted-v4) has its scale in its
    weights already and passes 1.0; the hand-weighted sprint model passes SPRINT_SOFTMAX_TEMPERATURE."""
    print(f"[{job_name}] race_id={race_id}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "SELECT driver_id, raw_weighted_score FROM {table} "
                    "WHERE race_id = %s ORDER BY driver_id"
                ).format(table=sql.Identifier(feature_table)),
                (race_id,),
            )
            feature_rows = cur.fetchall()

        if not feature_rows:
            raise ValueError(not_found_error)

        driver_ids = [r["driver_id"] for r in feature_rows]
        raw_scores = [float(r["raw_weighted_score"]) for r in feature_rows]

        probabilities = softmax(raw_scores, temperature=temperature)
        assert abs(sum(probabilities) - 1.0) < 1e-4, "Probabilities do not sum to 1"

        # Rank: position 1 = highest probability
        position_map, predicted_winner_id = rank_by_probability(driver_ids, probabilities)

        with conn.cursor() as cur:
            update_rows = [
                (round(probabilities[i], 5), position_map[driver_id], race_id, driver_id)
                for i, driver_id in enumerate(driver_ids)
            ]
            execute_batch(
                cur,
                sql.SQL(
                    "UPDATE {table} SET win_probability = %s, predicted_position = %s "
                    "WHERE race_id = %s AND driver_id = %s"
                ).format(table=sql.Identifier(feature_table)),
                update_rows,
            )

            cur.execute(
                sql.SQL(
                    """
                    INSERT INTO {table} (race_id, predicted_winner_id, computed_at, model_version)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (race_id) DO UPDATE SET
                        predicted_winner_id = EXCLUDED.predicted_winner_id,
                        computed_at = EXCLUDED.computed_at,
                        model_version = EXCLUDED.model_version
                    """
                ).format(table=sql.Identifier(prediction_table)),
                (race_id, predicted_winner_id, datetime.now(timezone.utc), model_version),
            )

        conn.commit()
        winner_probability = probabilities[driver_ids.index(predicted_winner_id)]
        print(f"  {winner_label}: driver_id={predicted_winner_id} "
              f"(p={round(winner_probability, 3)})")

    finally:
        conn.close()
