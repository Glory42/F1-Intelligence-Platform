from typing import Any, Optional

from src.utils.feature_context import FeatureContext
from src.utils.feature_helpers import compute_rolling_teammate_delta
from src.utils.feature_manifest import SPRINT_FEATURES, SPRINT_WEIGHTS as WEIGHTS  # noqa: F401 (re-exported)
from src.utils.feature_runner import (
    DriverScorer,
    FeatureJobSpec,
    ModelScores,
    run_feature_job,
    weather_unknown_before_session,
)
from src.utils.math_utils import bayesian_win_rate, clamp, normalize_minmax

SPRINT_FORMATS = ("sprint", "sprint_qualifying", "sprint_shootout")
# Below this many sprints a driver's GP rating and win rate stand in for the sprint ones.
MIN_SPRINTS_FOR_RATING = 3


def _validate_sprint_weekend(race: dict[str, Any]) -> None:
    if race["event_format"] not in SPRINT_FORMATS:
        raise ValueError(
            f"Race {race['id']} has event_format='{race['event_format']}': "
            "compute_sprint_features only runs on sprint weekends"
        )


def _score_drivers(conn: Any, ctx: FeatureContext) -> DriverScorer:
    short_run_map = _compute_short_run_pace(conn, ctx.driver_ids, ctx.race_id)
    sq_delta_map = compute_rolling_teammate_delta(
        conn, ctx.driver_ids, ctx.race_id,
        table="sprint_results",
        time_cols=("sq1_time_ms", "sq2_time_ms", "sq3_time_ms"),
        status_filter=("sprint_qualifying_done", "sprint_done", "qualifying_done", "completed"),
    )

    def score(driver_id: int, stat: Optional[dict[str, Any]]) -> ModelScores:
        if stat:
            sprint_races = int(stat["sprint_races_entered"] or 0)
            sprint_wins = int(stat["sprint_wins"] or 0)
            sprint_pts = float(stat["sprint_total_points"] or 0.0)
            race_races = int(stat["races_entered"])
            race_wins = int(stat["wins"])
            race_pts = float(stat["total_points"])
        else:
            sprint_races = sprint_wins = race_races = race_wins = 0
            sprint_pts = race_pts = 0.0

        if sprint_races >= MIN_SPRINTS_FOR_RATING:
            driver_rating = clamp(sprint_pts / max(sprint_races, 1) / 8.0)
            win_rate = bayesian_win_rate(sprint_wins, sprint_races)
        else:
            driver_rating = clamp(race_pts / max(race_races, 1) / 25.0)
            win_rate = bayesian_win_rate(race_wins, race_races)

        return ModelScores(features={
            "short_run_pace": short_run_map.get(driver_id, 0.5),
            "driver_rating": driver_rating,
            "win_rate": win_rate,
            "sq_qualifying_delta": sq_delta_map.get(driver_id, 0.5),
        })

    return score


# Sprint races are ~17 laps with no pit strategy: grid position dominates over strategy.
SPEC = FeatureJobSpec(
    job_name="compute_sprint_features",
    model_version="sprint-v2",
    feature_table="driver_sprint_features",
    features=SPRINT_FEATURES,
    grid_table="sprint_results",
    grid_missing="No sprint results (grid) for race {race_id}: run ingest_sprint first",
    weather=weather_unknown_before_session,
    score_drivers=_score_drivers,
    validate_race=_validate_sprint_weekend,
)


def run(race_id: int) -> None:
    run_feature_job(SPEC, race_id)


# ── Feature helpers ────────────────────────────────────────────────────────────

def _compute_short_run_pace(conn, driver_ids, race_id):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT sr.driver_id,
                   LEAST(NULLIF(sr.sq3_time_ms,0), NULLIF(sr.sq2_time_ms,0), NULLIF(sr.sq1_time_ms,0)) AS best_ms
            FROM sprint_results sr
            WHERE sr.race_id = %s AND sr.driver_id = ANY(%s)
            """,
            (race_id, driver_ids),
        )
        rows = {r["driver_id"]: r["best_ms"] for r in cur.fetchall()}

    if not any(v for v in rows.values()):
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT qr.driver_id,
                       LEAST(NULLIF(qr.q3_time_ms,0), NULLIF(qr.q2_time_ms,0), NULLIF(qr.q1_time_ms,0)) AS best_ms
                FROM qualifying_results qr
                WHERE qr.race_id = %s AND qr.driver_id = ANY(%s)
                """,
                (race_id, driver_ids),
            )
            rows = {r["driver_id"]: r["best_ms"] for r in cur.fetchall()}

    if not rows or not any(v for v in rows.values()):
        return {d: 0.5 for d in driver_ids}

    pairs = [(d, float(rows[d])) for d in driver_ids if d in rows and rows[d]]
    if not pairs:
        return {d: 0.5 for d in driver_ids}

    max_t = max(t for _, t in pairs)
    inverted = {did: max_t - t for did, t in pairs}
    normed = normalize_minmax(list(inverted.values()))
    ids = list(inverted.keys())
    result = {ids[i]: normed[i] for i in range(len(ids))}
    return {d: result.get(d, 0.5) for d in driver_ids}

