"""The shared half of the GP and sprint feature jobs: read the race context, score the features
both models share (car performance, circuit-adjusted start, luck, weather), ask the model's spec for
its own, weight them by the model's manifest and write one row per driver."""
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from src.db.client import get_conn
from src.utils.feature_context import FeatureContext, build_feature_context
from src.utils.feature_helpers import (
    blend_car_perf,
    circuit_adj_start_pos,
    compute_luck_score,
    compute_team_circuit_perf,
    compute_weather_score,
)
from src.utils.feature_manifest import FeatureSpec, assemble_scores
from src.utils.math_utils import weighted_sum
from src.utils.upsert import upsert


@dataclass(frozen=True)
class ModelScores:
    """One driver's model-specific feature scores, plus any extra columns its table stores."""

    features: dict[str, float]
    columns: dict[str, Any] = field(default_factory=dict)


DriverScorer = Callable[[int, Optional[dict[str, Any]]], ModelScores]


@dataclass(frozen=True)
class FeatureJobSpec:
    job_name: str
    model_version: str
    feature_table: str
    features: tuple[FeatureSpec, ...]
    grid_table: str
    grid_missing: str  # .format(race_id=)
    weather: Callable[[FeatureContext], str]
    # Runs the model's own queries once, then scores each driver from its season stats row.
    score_drivers: Callable[[Any, FeatureContext], DriverScorer]
    validate_race: Optional[Callable[[dict[str, Any]], None]] = None


def _car_performance(conn: Any, ctx: FeatureContext) -> dict[int, float]:
    """Season car performance, nudged toward the car's form at this circuit category."""
    category = compute_team_circuit_perf(conn, ctx.driver_ids, ctx.race_id, ctx.circuit_category) \
        if ctx.circuit_category else {}
    out = {}
    for driver_id in ctx.driver_ids:
        stat = ctx.stats_rows.get(driver_id)
        team_id = stat["team_id"] if stat else None
        season = ctx.team_perf.get(team_id, 0.5) if team_id else 0.5
        cat = category.get(driver_id) or {"score": None, "n": 0}
        out[driver_id] = blend_car_perf(season, cat.get("score"), cat.get("n") or 0)
    return out


def run_feature_job(spec: FeatureJobSpec, race_id: int) -> None:
    print(f"[{spec.job_name}] race_id={race_id}")
    weights = {f.name: f.weight for f in spec.features}

    conn = get_conn()
    try:
        ctx = build_feature_context(
            conn, race_id,
            grid_table=spec.grid_table,
            grid_not_found_message=spec.grid_missing.format(race_id=race_id),
            validate_race=spec.validate_race,
        )
        luck = compute_luck_score(conn, ctx.driver_ids, race_id, ctx.team_perf, ctx.stats_rows)
        weather = compute_weather_score(conn, ctx.driver_ids, spec.weather(ctx))
        score_driver = spec.score_drivers(conn, ctx)
        car_performance = _car_performance(conn, ctx)

        rows = []
        for driver_id in ctx.driver_ids:
            start_pos = ctx.start_pos_map[driver_id]
            model = score_driver(driver_id, ctx.stats_rows.get(driver_id))
            values = {
                "car_performance": car_performance[driver_id],
                "circuit_adj_start_pos": circuit_adj_start_pos(start_pos, ctx.overtake_rate, ctx.sc_probability),
                "luck_factor": luck.get(driver_id, 0.5),
                "weather_impact": weather.get(driver_id, 0.5),
                **model.features,
            }
            raw = weighted_sum(assemble_scores(values, spec.features), weights)
            rows.append({
                "race_id": race_id,
                "driver_id": driver_id,
                **{f"{f.name}_score": round(values[f.name], 5) for f in spec.features},
                "starting_position_score": round(start_pos, 5),
                "track_overtake_score": None,
                **model.columns,
                "raw_weighted_score": round(raw, 6),
                "win_probability": 0.0,
                "predicted_position": None,
            })

        upsert(conn, spec.feature_table, rows, ["race_id", "driver_id"])
        print(f"  Computed features for {len(rows)} drivers ({spec.model_version})")
    finally:
        conn.close()
