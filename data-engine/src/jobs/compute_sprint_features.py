from collections import defaultdict
from typing import Any
from src.db.client import get_conn
from src.utils.math_utils import normalize_minmax, bayesian_win_rate, clamp, weighted_sum
from src.utils.upsert import upsert
from src.utils.feature_context import build_feature_context
from src.utils.feature_helpers import (
    compute_weather_score,
    compute_luck_score,
    circuit_adj_start_pos as calc_circuit_adj_start_pos,
    compute_rolling_teammate_delta,
    compute_team_circuit_perf,
    blend_car_perf,
)
from src.utils.feature_manifest import SPRINT_FEATURES, SPRINT_WEIGHTS as WEIGHTS, assemble_scores

# Sprint races are ~17 laps with no pit strategy: grid position dominates over strategy.


def run(race_id: int) -> None:
    print(f"[compute_sprint_features] race_id={race_id}")

    conn = get_conn()
    try:
        def _validate_sprint_weekend(race: dict[str, Any]) -> None:
            if race["event_format"] not in ("sprint", "sprint_qualifying", "sprint_shootout"):
                raise ValueError(
                    f"Race {race_id} has event_format='{race['event_format']}': "
                    "compute_sprint_features only runs on sprint weekends"
                )

        ctx = build_feature_context(
            conn, race_id,
            grid_table="sprint_results",
            grid_not_found_message=f"No sprint results (grid) for race {race_id}: run ingest_sprint first",
            validate_race=_validate_sprint_weekend,
        )

        season_id = ctx.season_id
        weather = ctx.sprint_weather or ctx.weather or "dry"
        overtake_rate = ctx.overtake_rate
        sc_probability = ctx.sc_probability
        driver_ids = ctx.driver_ids
        stats_rows = ctx.stats_rows
        team_perf = ctx.team_perf

        short_run_map  = _compute_short_run_pace(conn, driver_ids, race_id)
        weather_map    = compute_weather_score(conn, driver_ids, weather)
        luck_map       = compute_luck_score(conn, driver_ids, race_id, team_perf, stats_rows)
        sq_delta_map   = compute_rolling_teammate_delta(
            conn, driver_ids, race_id,
            table="sprint_results",
            time_cols=("sq1_time_ms", "sq2_time_ms", "sq3_time_ms"),
            status_filter=("sprint_qualifying_done", "sprint_done", "qualifying_done", "completed"),
        )

        cat_perf_map = compute_team_circuit_perf(
            conn, driver_ids, race_id, ctx.circuit_category
        ) if ctx.circuit_category else {d: {"score": None, "n": 0} for d in driver_ids}

        rows_to_upsert = []
        for driver_id in driver_ids:
            stat = stats_rows.get(driver_id)
            team_id = stat["team_id"] if stat else None
            car_perf_season = team_perf.get(team_id, 0.5) if team_id else 0.5
            cat_stat = cat_perf_map.get(driver_id) or {"score": None, "n": 0}
            car_perf = blend_car_perf(car_perf_season, cat_stat.get("score"), cat_stat.get("n") or 0)

            if stat:
                sprint_races = int(stat["sprint_races_entered"] or 0)
                sprint_wins  = int(stat["sprint_wins"] or 0)
                sprint_pts   = float(stat["sprint_total_points"] or 0.0)
                race_races   = int(stat["races_entered"])
                race_wins    = int(stat["wins"])
                race_pts     = float(stat["total_points"])
            else:
                sprint_races = sprint_wins = race_races = race_wins = 0
                sprint_pts = race_pts = 0.0

            if sprint_races >= 3:
                driver_rating = clamp(sprint_pts / max(sprint_races, 1) / 8.0)
                win_rate = bayesian_win_rate(sprint_wins, sprint_races)
            else:
                driver_rating = clamp(race_pts / max(race_races, 1) / 25.0)
                win_rate = bayesian_win_rate(race_wins, race_races)

            start_pos = ctx.start_pos_map[driver_id]

            # Circuit-context multiplier: shared with the GP model, see feature_helpers.
            circuit_adj_start_pos = calc_circuit_adj_start_pos(start_pos, overtake_rate, sc_probability)

            short_run     = short_run_map.get(driver_id, 0.5)
            weather_score = weather_map.get(driver_id, 0.5)
            luck          = luck_map.get(driver_id, 0.5)
            sq_delta      = sq_delta_map.get(driver_id, 0.5)

            feature_values = {
                "car_performance": car_perf,
                "circuit_adj_start_pos": circuit_adj_start_pos,
                "short_run_pace": short_run,
                "driver_rating": driver_rating,
                "weather_impact": weather_score,
                "win_rate": win_rate,
                "luck_factor": luck,
                "sq_qualifying_delta": sq_delta,
            }
            raw = weighted_sum(assemble_scores(feature_values, SPRINT_FEATURES), WEIGHTS)

            rows_to_upsert.append({
                "race_id": race_id,
                "driver_id": driver_id,
                **{f"{f.name}_score": round(feature_values[f.name], 5) for f in SPRINT_FEATURES},
                "starting_position_score": round(start_pos, 5),
                "track_overtake_score": None,
                "raw_weighted_score": round(raw, 6),
                "win_probability": 0.0,
                "predicted_position": None,
            })

        upsert(conn, "driver_sprint_features", rows_to_upsert, ["race_id", "driver_id"])
        print(f"  Computed sprint features for {len(rows_to_upsert)} drivers (sprint-v2)")

    finally:
        conn.close()


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

