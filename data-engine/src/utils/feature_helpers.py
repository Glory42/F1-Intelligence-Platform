from collections import defaultdict
from src.utils.math_utils import normalize_minmax, clamp

# Weight of the circuit-category signal vs season car_performance_score, ramping in
# as more same-category races are observed (w = 0 until a team has >=2 such races).
CAR_CIRCUIT_BLEND_MAX = 0.35
CAR_CIRCUIT_MIN_RACES = 2
CAR_CIRCUIT_RAMP_RACES = 6


def compute_compressed_car_perf(
    pace_signals: list[float],
    grid_signals: list[float],
    rel_weight: float = 0.5,
) -> list[float]:
    """Blends relative field min-max with an absolute grid scale (1..20) so top-tier
    constructors don't get runaway 1.0 vs 0.74 gaps."""
    if not pace_signals or not grid_signals:
        return []
    raw = [0.6 * p + 0.4 * g for p, g in zip(pace_signals, grid_signals)]
    rel_norm = normalize_minmax(raw)
    abs_norm = [clamp((s - 1.0) / 19.0, 0.0, 1.0) for s in raw]
    return [clamp(rel_weight * r + (1.0 - rel_weight) * a) for r, a in zip(rel_norm, abs_norm)]


def blend_car_perf(season: float, category: float | None, category_races: int) -> float:
    """`category` is None with no history at this circuit category (season signal used
    unchanged); otherwise the category weight ramps 0->max as sample size grows (2..6)."""
    if category is None or category_races < CAR_CIRCUIT_MIN_RACES:
        return clamp(season)
    ramp = (category_races - CAR_CIRCUIT_MIN_RACES) / max(CAR_CIRCUIT_RAMP_RACES - CAR_CIRCUIT_MIN_RACES, 1)
    w = CAR_CIRCUIT_BLEND_MAX * min(1.0, ramp)
    return clamp(season * (1 - w) + category * w)


def compute_team_circuit_perf(conn, driver_ids: list[int], race_id: int, circuit_category: str) -> dict[int, dict]:
    """Cross-season via driver.code; returns {driver_id: {"score": 0-1 | None, "n": count}},
    score None below CAR_CIRCUIT_MIN_RACES. high_speed tracks also blend in speed trap pace."""
    with conn.cursor() as cur:
        cur.execute("SELECT race_date FROM races WHERE id = %s", (race_id,))
        race_info = cur.fetchone()
    if not race_info:
        return {d: {"score": None, "n": 0} for d in driver_ids}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d_cur.id AS driver_id,
                   AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS cat_avg,
                   COUNT(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS cat_n
            FROM drivers d_cur
            JOIN drivers d_hist ON d_hist.code = d_cur.code
            JOIN race_results rr ON rr.driver_id = d_hist.id
            JOIN races r ON rr.race_id = r.id
            JOIN circuits c ON r.circuit_id = c.id
            WHERE d_cur.id = ANY(%s)
              AND r.status = 'completed'
              AND r.id != %s
              AND r.race_date <= %s
              AND c.track_category = %s
            GROUP BY d_cur.id
            """,
            (driver_ids, race_id, race_info["race_date"], circuit_category),
        )
        rows = {r["driver_id"]: r for r in cur.fetchall()}

    valid = {
        d: 21.0 - float(r["cat_avg"])
        for d, r in rows.items()
        if r["cat_n"] and int(r["cat_n"]) >= CAR_CIRCUIT_MIN_RACES
    }

    # For high-speed circuits, straight-line power & speed trap pace provides an additional signal
    speed_rows: dict[int, float] = {}
    if circuit_category == "high_speed" and valid:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d_cur.id AS driver_id,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lt.speed_st::numeric) AS med_speed
                FROM drivers d_cur
                JOIN drivers d_hist ON d_hist.code = d_cur.code
                JOIN lap_times lt ON lt.driver_id = d_hist.id
                JOIN races r ON lt.race_id = r.id
                JOIN circuits c ON r.circuit_id = c.id
                WHERE d_cur.id = ANY(%s)
                  AND r.status = 'completed'
                  AND r.id != %s
                  AND r.race_date <= %s
                  AND c.track_category = 'high_speed'
                  AND lt.speed_st IS NOT NULL AND lt.speed_st > 0
                  AND lt.is_pit_lap = false
                GROUP BY d_cur.id
                """,
                (driver_ids, race_id, race_info["race_date"]),
            )
            speed_rows = {
                r["driver_id"]: float(r["med_speed"])
                for r in cur.fetchall()
                if r["med_speed"] is not None
            }

    if speed_rows and all(d in speed_rows for d in valid):
        speed_norm = normalize_minmax([speed_rows[d] for d in valid])
        finish_norm = normalize_minmax(list(valid.values()))
        normalized = [0.7 * f + 0.3 * s for f, s in zip(finish_norm, speed_norm)]
    else:
        normalized = normalize_minmax(list(valid.values())) if valid else []

    out: dict[int, dict] = {}
    for idx, d in enumerate(valid):
        out[d] = {"score": normalized[idx], "n": int(rows[d]["cat_n"])}
    for d in driver_ids:
        if d not in out:
            row = rows.get(d)
            out[d] = {"score": None, "n": int(row["cat_n"]) if row else 0}
    return out


def compute_weather_score(conn, driver_ids: list[int], weather: str) -> dict[int, float]:
    """Historical wet-race finish position (cross-season via driver.code), normalized. Neutral (0.5) if dry."""
    if weather == "dry":
        return {d: 0.5 for d in driver_ids}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d_cur.id AS driver_id,
                   AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS wet_avg,
                   COUNT(*) AS wet_races
            FROM drivers d_cur
            JOIN drivers d_hist ON d_hist.code = d_cur.code
            JOIN race_results rr ON rr.driver_id = d_hist.id
            JOIN races r ON rr.race_id = r.id
            WHERE r.weather IN ('wet', 'mixed') AND d_cur.id = ANY(%s)
            GROUP BY d_cur.id
            """,
            (driver_ids,),
        )
        wet_rows = {r["driver_id"]: r for r in cur.fetchall()}

    raw = []
    for d in driver_ids:
        row = wet_rows.get(d)
        if row and row["wet_races"] and int(row["wet_races"]) >= 1:
            raw.append(21.0 - float(row["wet_avg"]))
        else:
            raw.append(None)

    valid = [s for s in raw if s is not None]
    field_avg = sum(valid) / len(valid) if valid else 10.5
    filled = [s if s is not None else field_avg for s in raw]
    normalized = normalize_minmax(filled)
    return {driver_ids[i]: normalized[i] for i in range(len(driver_ids))}


def car_rank(team_id, team_perf: dict) -> float:
    if not team_id:
        return 10.0
    return 20.0 - (team_perf.get(team_id, 0.5) * 19.0)


def compute_luck_score(conn, driver_ids: list[int], race_id: int, team_perf: dict, stats_rows: dict) -> dict[int, float]:
    """Finish position vs expected (avg of grid + car rank), last 5 completed races, cross-season via driver.code."""
    with conn.cursor() as cur:
        cur.execute("SELECT race_date FROM races WHERE id = %s", (race_id,))
        race_info = cur.fetchone()
    if not race_info:
        return {d: 0.5 for d in driver_ids}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT driver_id, grid_position, finish_position FROM (
                SELECT d_cur.id AS driver_id, rr.grid_position, rr.finish_position,
                       ROW_NUMBER() OVER (PARTITION BY d_cur.id ORDER BY r.race_date DESC) AS rn
                FROM drivers d_cur
                JOIN drivers d_hist ON d_hist.code = d_cur.code
                JOIN race_results rr ON rr.driver_id = d_hist.id
                JOIN races r ON rr.race_id = r.id
                WHERE d_cur.id = ANY(%s)
                  AND r.status = 'completed'
                  AND r.race_date < %s
                  AND rr.finish_position IS NOT NULL
            ) t WHERE rn <= 5
            """,
            (driver_ids, race_info["race_date"]),
        )
        driver_results: dict[int, list] = defaultdict(list)
        for row in cur.fetchall():
            driver_results[row["driver_id"]].append(row)

    deltas = {}
    for driver_id in driver_ids:
        team_id = stats_rows.get(driver_id, {}).get("team_id")
        rank = car_rank(team_id, team_perf)
        recent = driver_results[driver_id]
        if not recent:
            deltas[driver_id] = 0.0
            continue
        driver_deltas = [(rr["grid_position"] + rank) / 2.0 - rr["finish_position"] for rr in recent]
        deltas[driver_id] = sum(driver_deltas) / len(driver_deltas)

    vals = list(deltas.values())
    normalized = normalize_minmax(vals)
    return {driver_id: normalized[i] for i, driver_id in enumerate(deltas.keys())}


def circuit_adj_start_pos(start_pos: float, overtake_rate: float, sc_probability: float) -> float:
    """Grid position matters more at low-overtake tracks; high SC probability bunches the
    field, reducing it further. Shared by GP and sprint: same formula, different WEIGHTS."""
    return clamp(start_pos * (1 + (1 - overtake_rate)) * (1 - 0.3 * sc_probability))


def compute_rolling_teammate_delta(
    conn,
    driver_ids: list[int],
    race_id: int,
    *,
    table: str,
    time_cols: tuple[str, str, str],
    status_filter: tuple[str, ...],
) -> dict[int, float]:
    """Weighted mean (recent=5..oldest=1) teammate delta over the last 5 sessions, cross-season.
    `table`/`time_cols`/`status_filter` pick GP vs sprint qualifying; the algorithm is shared."""
    with conn.cursor() as cur:
        cur.execute("SELECT race_date FROM races WHERE id = %s", (race_id,))
        race_info = cur.fetchone()
    if not race_info:
        return {d: 0.5 for d in driver_ids}

    q1_col, q2_col, q3_col = time_cols

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT sub.driver_id, sub.team_id, sub.best_ms, sub.race_date,
                   ROW_NUMBER() OVER (PARTITION BY sub.driver_id ORDER BY sub.race_date DESC) AS rn
            FROM (
                SELECT d_cur.id AS driver_id, d_hist.team_id,
                       LEAST(NULLIF(qr.{q3_col},0), NULLIF(qr.{q2_col},0), NULLIF(qr.{q1_col},0)) AS best_ms,
                       r.race_date
                FROM drivers d_cur
                JOIN drivers d_hist ON d_hist.code = d_cur.code
                JOIN {table} qr ON qr.driver_id = d_hist.id
                JOIN races r ON qr.race_id = r.id
                WHERE d_cur.id = ANY(%s)
                  AND r.race_date <= %s
                  AND r.status::text = ANY(%s)
            ) sub
            WHERE sub.best_ms IS NOT NULL
            """,
            (driver_ids, race_info["race_date"], list(status_filter)),
        )
        all_rows = cur.fetchall()

    recent_by_driver: dict[int, list] = defaultdict(list)
    for row in all_rows:
        if row["rn"] <= 5:
            recent_by_driver[row["driver_id"]].append(row)

    session_team: dict[tuple, list] = defaultdict(list)
    for driver_id, rows in recent_by_driver.items():
        for row in rows:
            key = (str(row["race_date"]), row["team_id"])
            session_team[key].append((driver_id, float(row["best_ms"])))

    weighted_deltas: dict[int, float] = {}
    for driver_id, rows in recent_by_driver.items():
        sorted_rows = sorted(rows, key=lambda r: r["race_date"], reverse=True)
        sum_w, sum_wd = 0.0, 0.0
        for idx, row in enumerate(sorted_rows):
            weight = 5 - idx
            key = (str(row["race_date"]), row["team_id"])
            teammates = [(did, t) for did, t in session_team[key] if did != driver_id]
            if not teammates:
                continue
            best_teammate_ms = min(t for _, t in teammates)
            delta = (best_teammate_ms - float(row["best_ms"])) / best_teammate_ms
            sum_wd += delta * weight
            sum_w += weight
        weighted_deltas[driver_id] = sum_wd / sum_w if sum_w > 0 else 0.0

    vals = [weighted_deltas.get(d, 0.0) for d in driver_ids]
    normalized = normalize_minmax(vals) if len(set(vals)) > 1 else vals
    return {driver_ids[i]: normalized[i] for i in range(len(driver_ids))}
