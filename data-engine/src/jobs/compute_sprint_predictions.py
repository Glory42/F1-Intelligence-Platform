from src.utils.feature_manifest import SPRINT_SOFTMAX_TEMPERATURE
from src.utils.prediction_runner import run_prediction_job


def run(race_id: int) -> None:
    run_prediction_job(
        race_id,
        job_name="compute_sprint_predictions",
        feature_table="driver_sprint_features",
        prediction_table="sprint_predictions",
        model_version="sprint-v2",
        not_found_error=f"No sprint feature rows for race {race_id}: run compute_sprint_features first",
        winner_label="Sprint predicted winner",
        temperature=SPRINT_SOFTMAX_TEMPERATURE,
    )
