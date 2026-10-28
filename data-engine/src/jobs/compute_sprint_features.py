"""sprint-v2, the hand-weighted sprint model: eight 0–1 Feature Scores per driver, combined by the manifest's
weights and a softmax at SPRINT_SOFTMAX_TEMPERATURE, written with the predicted sprint winner in one
transaction. Sprint races are ~17 laps with no pit strategy: grid position dominates over strategy."""
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from src.db.client import get_conn
from src.utils.feature_helpers import (
    SamePerson,
    blend_car_perf,
    circuit_adj_start_pos,
    compute_luck_score,
    compute_rolling_teammate_delta,
    compute_team_circuit_perf,
    same_person_rows,
)
from src.utils.feature_manifest import (
    SPRINT_FEATURES,
    SPRINT_MODEL_VERSION,
    SPRINT_SOFTMAX_TEMPERATURE,
    SPRINT_WEIGHTS as WEIGHTS,
    assemble_scores,
)
from src.utils.math_utils import bayesian_win_rate, clamp, normalize_minmax, softmax, weighted_sum
from src.utils.season_aggregates import (
    driver_feature_stats,
    driver_race_aggregates,
    driver_sprint_aggregates,
    team_race_aggregates,
    team_scores,
)
from src.utils.upsert import upsert
from src.session_kind import is_sprint_weekend

# Below this many sprints a driver's GP rating and win rate stand in for the sprint ones.
MIN_SPRINTS_FOR_RATING = 3
# races.weather / sprint_weather are written after the session, so a prediction can't know them: reading
# them let recomputed past races see whether it rained. The feature stays neutral until a forecast exists.
NEUTRAL_WEATHER = 0.5


@dataclass(frozen=True)
class _Weekend:
    race_id: int
    race_date: date
    overtake_rate: float
    sc_probability: float
    circuit_category: str | None
    driver_ids: list[int]
    start_pos: dict[int, float]
    stats_rows: dict[int, dict[str, Any]]
    team_perf: dict[int, float]


def _weekend(conn: Any, race_id: int) -> _Weekend:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.race_date, r.event_format, "
            "       c.overtake_rate, c.sc_probability, c.track_category "
            "FROM races r JOIN circuits c ON r.circuit_id = c.id WHERE r.id = %s",
            (race_id,),
        )
        race = cur.fetchone()
    if not race:
        raise ValueError(f"Race {race_id} not found")
    if not is_sprint_weekend(race["event_format"]):
        raise ValueError(
            f"Race {race_id} has event_format='{race['event_format']}': "
            "compute_sprint_features only runs on sprint weekends"
        )
    with conn.cursor() as cur:
        cur.execute("SELECT g.driver_id, g.grid_position FROM sprint_results g WHERE g.race_id = %s", (race_id,))
        grid = {r["driver_id"]: r["grid_position"] for r in cur.fetchall()}
    if not grid:
        raise ValueError(f"No sprint results (grid) for race {race_id}: run ingest_sprint first")

    driver_ids = list(grid)
    # As of the race date, not the stored season rows: a recomputed past race must not see its own result.
    before = race["race_date"]
    season = driver_feature_stats(
        driver_race_aggregates(conn, race["season_id"], before),
        driver_sprint_aggregates(conn, race["season_id"], before),
    )
    teams = team_scores(team_race_aggregates(conn, race["season_id"], before))
    return _Weekend(
        race_id=race_id,
        race_date=race["race_date"],
        overtake_rate=float(race["overtake_rate"]) if race["overtake_rate"] is not None else 0.5,
        sc_probability=float(race["sc_probability"]) if race["sc_probability"] is not None else 0.3,
        circuit_category=race.get("track_category"),
        driver_ids=driver_ids,
        start_pos={d: (21 - (grid.get(d) or 20)) / 20.0 for d in driver_ids},
        stats_rows={d: season[d] for d in driver_ids if d in season},
        team_perf={tid: v["car_perf"] for tid, v in teams.items()},
    )


def _car_performance(conn: Any, same: SamePerson, w: _Weekend) -> dict[int, float]:
    """Season car performance, nudged toward the car's form at this circuit category."""
    category = compute_team_circuit_perf(conn, same, w.driver_ids, w.race_id, w.race_date, w.circuit_category) \
        if w.circuit_category else {}
    out = {}
    for driver_id in w.driver_ids:
        stat = w.stats_rows.get(driver_id)
        team_id = stat["team_id"] if stat else None
        season = w.team_perf.get(team_id, 0.5) if team_id else 0.5
        cat = category.get(driver_id) or {"score": None, "n": 0}
        out[driver_id] = blend_car_perf(season, cat.get("score"), cat.get("n") or 0)
    return out


def _rating_and_win_rate(stat: dict[str, Any] | None) -> tuple[float, float]:
    if not stat:
        return clamp(0.0), bayesian_win_rate(0, 0)
    sprint_races = int(stat["sprint_races_entered"] or 0)
    if sprint_races >= MIN_SPRINTS_FOR_RATING:
        rating = clamp(float(stat["sprint_total_points"] or 0.0) / sprint_races / 8.0)
        return rating, bayesian_win_rate(int(stat["sprint_wins"] or 0), sprint_races)
    races = int(stat["races_entered"])
    rating = clamp(float(stat["total_points"]) / max(races, 1) / 25.0)
    return rating, bayesian_win_rate(int(stat["wins"]), races)


def _short_run_pace(conn: Any, driver_ids: list[int], race_id: int) -> dict[int, float]:
    """This weekend's best Sprint Qualifying lap, falling back to main qualifying, min-max over the field."""
    best_ms: dict[int, Any] = {}
    for table, cols in (("sprint_results", ("sq3_time_ms", "sq2_time_ms", "sq1_time_ms")),
                        ("qualifying_results", ("q3_time_ms", "q2_time_ms", "q1_time_ms"))):
        least = ", ".join(f"NULLIF(t.{c},0)" for c in cols)
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT t.driver_id, LEAST({least}) AS best_ms FROM {table} t "
                "WHERE t.race_id = %s AND t.driver_id = ANY(%s)",
                (race_id, driver_ids),
            )
            best_ms = {r["driver_id"]: r["best_ms"] for r in cur.fetchall()}
        if any(best_ms.values()):
            break

    pairs = [(d, float(best_ms[d])) for d in driver_ids if best_ms.get(d)]
    if not pairs:
        return {d: 0.5 for d in driver_ids}
    slowest = max(t for _, t in pairs)
    normed = normalize_minmax([slowest - t for _, t in pairs])
    scored = {d: normed[i] for i, (d, _) in enumerate(pairs)}
    return {d: scored.get(d, 0.5) for d in driver_ids}


def feature_scores(conn: Any, race_id: int) -> tuple[_Weekend, dict[int, dict[str, float]]]:
    """driver_id → the eight sprint-v2 Feature Scores, every one from data known before the sprint."""
    w = _weekend(conn, race_id)
    same = same_person_rows(conn, w.driver_ids)
    luck = compute_luck_score(conn, same, w.driver_ids, w.race_date, w.team_perf, w.stats_rows)
    sq_delta = compute_rolling_teammate_delta(conn, same, w.driver_ids, w.race_date)
    short_run = _short_run_pace(conn, w.driver_ids, race_id)
    car = _car_performance(conn, same, w)

    scores = {}
    for d in w.driver_ids:
        rating, win_rate = _rating_and_win_rate(w.stats_rows.get(d))
        scores[d] = assemble_scores({
            "car_performance": car[d],
            "circuit_adj_start_pos": circuit_adj_start_pos(w.start_pos[d], w.overtake_rate, w.sc_probability),
            "short_run_pace": short_run.get(d, 0.5),
            "driver_rating": rating,
            "weather_impact": NEUTRAL_WEATHER,
            "win_rate": win_rate,
            "luck_factor": luck.get(d, 0.5),
            "sq_qualifying_delta": sq_delta.get(d, 0.5),
        }, SPRINT_FEATURES)
    return w, scores


def prediction_rows(w: _Weekend, scores: dict[int, dict[str, float]]) -> list[dict[str, Any]]:
    """One row per driver, most likely sprint winner first."""
    raw = {d: weighted_sum(s, WEIGHTS) for d, s in scores.items()}
    drivers = list(raw)
    probability = dict(zip(drivers, softmax([raw[d] for d in drivers], temperature=SPRINT_SOFTMAX_TEMPERATURE)))
    ranked = sorted(drivers, key=lambda d: probability[d], reverse=True)
    return [
        {
            "race_id": w.race_id,
            "driver_id": d,
            **{f"{f.name}_score": round(scores[d][f.name], 5) for f in SPRINT_FEATURES},
            "starting_position_score": round(w.start_pos[d], 5),
            "raw_weighted_score": round(raw[d], 6),
            "win_probability": round(probability[d], 5),
            "predicted_position": i + 1,
        }
        for i, d in enumerate(ranked)
    ]


def run(race_id: int) -> None:
    print(f"[compute_sprint_features] race_id={race_id}")
    conn = get_conn()
    try:
        w, scores = feature_scores(conn, race_id)
        rows = prediction_rows(w, scores)
        upsert(conn, "driver_sprint_features", rows, ["race_id", "driver_id"], commit=False)
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM driver_sprint_features WHERE race_id = %s AND NOT (driver_id = ANY(%s))",
                (race_id, [r["driver_id"] for r in rows]),
            )
        upsert(conn, "sprint_predictions", [{
            "race_id": race_id,
            "predicted_winner_id": rows[0]["driver_id"],
            "computed_at": datetime.now(timezone.utc),
            "model_version": SPRINT_MODEL_VERSION,
        }], ["race_id"], commit=False)
        conn.commit()
        print(f"  {len(rows)} drivers ({SPRINT_MODEL_VERSION}); predicted sprint winner "
              f"driver_id={rows[0]['driver_id']} (p={rows[0]['win_probability']:.3f})")
    finally:
        conn.close()
