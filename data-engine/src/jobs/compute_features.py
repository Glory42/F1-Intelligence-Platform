from collections import defaultdict
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
from src.utils.feature_manifest import GP_FEATURES, GP_WEIGHTS as WEIGHTS, assemble_scores


def run(race_id: int) -> None:
    print(f"[compute_features] race_id={race_id}")

    conn = get_conn()
    try:
        ctx = build_feature_context(
            conn, race_id,
            grid_table="qualifying_results",
            grid_not_found_message=f"No qualifying results for race {race_id}",
        )

        season_id = ctx.season_id
        weather = ctx.weather or "dry"
        overtake_rate = ctx.overtake_rate
        sc_probability = ctx.sc_probability
        driver_ids = ctx.driver_ids
        stats_rows = ctx.stats_rows
        team_data = ctx.team_data
        team_perf = ctx.team_perf

        luck_map        = compute_luck_score(conn, driver_ids, race_id, team_perf, stats_rows)
        weather_map     = compute_weather_score(conn, driver_ids, weather)
        long_run_map, long_run_used_fp = _compute_long_run_pace(conn, driver_ids, race_id, ctx.circuit_id)
        reliability_map = _compute_reliability(driver_ids, stats_rows, team_data)
        quali_delta_map = compute_rolling_teammate_delta(
            conn, driver_ids, race_id,
            table="qualifying_results",
            time_cols=("q1_time_ms", "q2_time_ms", "q3_time_ms"),
            status_filter=("qualifying_done", "completed"),
        )
        sector_map      = _compute_sector_strength(conn, driver_ids, race_id)
        tyre_deg_map    = _compute_tyre_degradation(conn, driver_ids, race_id, ctx.circuit_id)

        # Nudges season car_perf toward a car's strength at this circuit category (e.g.
        # McLaren on high-downforce tracks); None => no history, falls back to season signal.
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
                races_entered = int(stat["races_entered"])
                wins = int(stat["wins"])
                pts = float(stat["total_points"])
                avg_gain = float(stat["avg_position_gain"]) if stat["avg_position_gain"] is not None else 0.0
            else:
                races_entered, wins, pts, avg_gain = 0, 0, 0.0, 0.0

            driver_rating = clamp(pts / max(races_entered, 1) / 25.0)
            win_rate = bayesian_win_rate(wins, races_entered)

            start_pos = ctx.start_pos_map[driver_id]
            position_gain = clamp((avg_gain + 15.0) / 30.0)

            # Circuit-context multiplier: shared with the sprint model, see feature_helpers.
            circuit_adj_start_pos = calc_circuit_adj_start_pos(start_pos, overtake_rate, sc_probability)
            # Position gain potential is only meaningful where overtaking is physically possible.
            circuit_adj_position_gain = clamp(position_gain * overtake_rate)

            luck         = luck_map.get(driver_id, 0.5)
            weather_score = weather_map.get(driver_id, 0.5)
            long_run     = long_run_map.get(driver_id, 0.5)
            reliability  = reliability_map.get(driver_id, 0.5)
            quali_delta  = quali_delta_map.get(driver_id, 0.5)
            sector_strength = sector_map.get(driver_id, 0.5)
            tyre_deg     = tyre_deg_map.get(driver_id, 0.5)

            feature_values = {
                "car_performance": car_perf,
                "long_run_pace": long_run,
                "tyre_deg": tyre_deg,
                "reliability": reliability,
                "qualifying_delta": quali_delta,
                "driver_rating": driver_rating,
                "win_rate": win_rate,
                "luck_factor": luck,
                "sector_strength": sector_strength,
                "circuit_adj_start_pos": circuit_adj_start_pos,
                "circuit_adj_position_gain": circuit_adj_position_gain,
                "weather_impact": weather_score,
            }
            raw = weighted_sum(assemble_scores(feature_values, GP_FEATURES), WEIGHTS)

            rows_to_upsert.append({
                "race_id": race_id,
                "driver_id": driver_id,
                **{f"{f.name}_score": round(feature_values[f.name], 5) for f in GP_FEATURES},
                "starting_position_score": round(start_pos, 5),
                "track_overtake_score": None,
                "position_gain_score": round(position_gain, 5),
                "long_run_used_fp": long_run_used_fp,
                "raw_weighted_score": round(raw, 6),
                "win_probability": 0.0,
                "predicted_position": None,
            })

        upsert(conn, "driver_prediction_features", rows_to_upsert, ["race_id", "driver_id"])
        print(f"  Computed features for {len(rows_to_upsert)} drivers (weighted-v3)")

    finally:
        conn.close()


# ── Feature helpers ────────────────────────────────────────────────────────────

def _compute_long_run_pace(conn, driver_ids: list[int], race_id: int, circuit_id: int) -> tuple[dict[int, float], bool]:
    """Practice long-run median (FP2, or FP1 on sprint weekends, same table); falls back to
    historical circuit median. `used_fp` flags which source was used, for the quality audit."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT driver_id, MIN(median_lap_ms) AS best_median_ms
            FROM fp2_long_run_times
            WHERE race_id = %s AND driver_id = ANY(%s) AND median_lap_ms IS NOT NULL
            GROUP BY driver_id
            """,
            (race_id, driver_ids),
        )
        fp2_map = {r["driver_id"]: float(r["best_median_ms"]) for r in cur.fetchall()}

    # Use FP2 when ≥70% of drivers have data; otherwise fall back to historical
    if len(fp2_map) >= len(driver_ids) * 0.7:
        pace_map, used_fp2 = fp2_map, True
    else:
        used_fp2 = False
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM races "
                "WHERE circuit_id = %s AND status = 'completed' AND id != %s "
                "ORDER BY race_date DESC LIMIT 6",
                (circuit_id, race_id),
            )
            past_ids = [r["id"] for r in cur.fetchall()]

        if not past_ids:
            return {d: 0.5 for d in driver_ids}, used_fp2

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT lt.driver_id,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lt.lap_time_ms) AS median_ms
                FROM lap_times lt
                WHERE lt.race_id = ANY(%s)
                  AND lt.driver_id = ANY(%s)
                  AND lt.is_pit_lap = false
                  AND lt.lap_number > 1
                  AND lt.lap_time_ms IS NOT NULL
                  AND lt.lap_time_ms > 0
                GROUP BY lt.driver_id
                """,
                (past_ids, driver_ids),
            )
            pace_map = {r["driver_id"]: float(r["median_ms"]) for r in cur.fetchall()}

    if not pace_map:
        return {d: 0.5 for d in driver_ids}, used_fp2

    worst = max(pace_map.values()) * 1.02
    times = [pace_map.get(d, worst) for d in driver_ids]
    max_t = max(times)
    inverted = [max_t - t for t in times]
    normalized = normalize_minmax(inverted)
    return {driver_ids[i]: normalized[i] for i in range(len(driver_ids))}, used_fp2


def blend_compound_slopes(
    compounds: list[tuple[float | None, int]],
    min_laps_per_compound: int = 8,
    min_total_laps: int = 10,
) -> float | None:
    """Lap-weighted average slope across (slope, lap_count) compound pairs meeting the
    per-compound floor, falling back to all compounds if total laps clear min_total_laps."""
    # Primary path: only compounds meeting the per-compound floor
    w_sum = 0.0
    w_total = 0
    for slope, n in compounds:
        if slope is not None and n >= min_laps_per_compound:
            w_sum += slope * n
            w_total += n

    if w_total > 0:
        return w_sum / w_total

    # Fallback path: no single compound qualified; check total laps
    total_n = sum(n for _, n in compounds)
    if total_n >= min_total_laps:
        w_sum = 0.0
        w_total = 0
        for slope, n in compounds:
            if slope is not None and n > 0:
                w_sum += slope * n
                w_total += n
        if w_total > 0:
            return w_sum / w_total

    return None


def _field_median(values: list[float]) -> float:
    """True median of a sorted list (averages the two middle values for even length)."""
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0


def _compute_tyre_degradation(conn, driver_ids: list[int], race_id: int, circuit_id: int) -> dict[int, float]:
    """Per-compound REGR_SLOPE, blended via blend_compound_slopes: avoids the ~0.5-0.9s
    cross-compound pace offset distorting the tyre-management signal. Lower slope = higher score."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM races "
            "WHERE circuit_id = %s AND status = 'completed' AND id != %s "
            "ORDER BY race_date DESC LIMIT 4",
            (circuit_id, race_id),
        )
        past_ids = [r["id"] for r in cur.fetchall()]

    if not past_ids:
        return {d: 0.5 for d in driver_ids}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d_cur.id AS driver_id,
                   REGR_SLOPE(lt.lap_time_ms::float, lt.tyre_life::float)
                     FILTER (WHERE lt.compound = 'SOFT')   AS soft_slope,
                   COUNT(*)
                     FILTER (WHERE lt.compound = 'SOFT')   AS soft_n,

                   REGR_SLOPE(lt.lap_time_ms::float, lt.tyre_life::float)
                     FILTER (WHERE lt.compound = 'MEDIUM') AS med_slope,
                   COUNT(*)
                     FILTER (WHERE lt.compound = 'MEDIUM') AS med_n,

                   REGR_SLOPE(lt.lap_time_ms::float, lt.tyre_life::float)
                     FILTER (WHERE lt.compound = 'HARD')   AS hard_slope,
                   COUNT(*)
                     FILTER (WHERE lt.compound = 'HARD')   AS hard_n
            FROM drivers d_cur
            JOIN drivers d_hist ON d_hist.code = d_cur.code
            JOIN lap_times lt ON lt.driver_id = d_hist.id
            WHERE lt.race_id = ANY(%s)
              AND d_cur.id = ANY(%s)
              AND lt.is_pit_lap = false
              AND lt.lap_time_ms IS NOT NULL AND lt.lap_time_ms > 0
              AND lt.tyre_life IS NOT NULL AND lt.tyre_life >= 3
              AND lt.compound IN ('SOFT', 'MEDIUM', 'HARD')
            GROUP BY d_cur.id
            """,
            (past_ids, driver_ids),
        )
        raw_rows = {r["driver_id"]: r for r in cur.fetchall()}

    slope_map: dict[int, float] = {}
    for driver_id, row in raw_rows.items():
        compounds = [
            (row["soft_slope"], int(row["soft_n"] or 0)),
            (row["med_slope"],  int(row["med_n"] or 0)),
            (row["hard_slope"], int(row["hard_n"] or 0)),
        ]
        blended = blend_compound_slopes(compounds)
        if blended is not None:
            slope_map[driver_id] = blended

    if not slope_map:
        return {d: 0.5 for d in driver_ids}

    median = _field_median(list(slope_map.values()))

    slopes = [slope_map.get(d, median) for d in driver_ids]
    max_slope = max(slopes)
    inverted = [max_slope - s for s in slopes]
    normalized = normalize_minmax(inverted) if len(set(inverted)) > 1 else [0.5] * len(driver_ids)
    return {driver_ids[i]: normalized[i] for i in range(len(driver_ids))}


def _compute_reliability(driver_ids, stats_rows, team_data):
    scores = []
    for d in driver_ids:
        stat = stats_rows.get(d)
        team_id = stat["team_id"] if stat else None
        team_rel = team_data.get(team_id, {}).get("reliability", 0.5) if team_id else 0.5
        dnf_rate = float(stat["dnf_rate"]) if stat and stat.get("dnf_rate") is not None else 0.1
        scores.append(team_rel * 0.7 + (1.0 - dnf_rate) * 0.3)

    normalized = normalize_minmax(scores) if len(set(scores)) > 1 else scores
    return {driver_ids[i]: normalized[i] for i in range(len(driver_ids))}


def _compute_sector_strength(conn, driver_ids, race_id):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT driver_id, sector1_ms, sector2_ms, sector3_ms "
            "FROM qualifying_results WHERE race_id = %s AND driver_id = ANY(%s)",
            (race_id, driver_ids),
        )
        rows = {r["driver_id"]: r for r in cur.fetchall()}

    if not rows or not any(r.get("sector1_ms") for r in rows.values()):
        return {d: 0.5 for d in driver_ids}

    def sector_norm(col):
        pairs = [(d, float(rows[d][col])) for d in driver_ids if d in rows and rows[d].get(col)]
        if not pairs:
            return {}
        max_t = max(t for _, t in pairs)
        inverted = {did: max_t - t for did, t in pairs}
        normed = normalize_minmax(list(inverted.values()))
        ids = list(inverted.keys())
        return {ids[i]: normed[i] for i in range(len(ids))}

    s1, s2, s3 = sector_norm("sector1_ms"), sector_norm("sector2_ms"), sector_norm("sector3_ms")
    combined = {}
    for d in driver_ids:
        scores = [s for s in [s1.get(d), s2.get(d), s3.get(d)] if s is not None]
        combined[d] = sum(scores) / len(scores) if scores else 0.5
    return combined


