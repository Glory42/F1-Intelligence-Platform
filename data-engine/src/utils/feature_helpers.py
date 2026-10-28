"""sprint-v2's database-backed feature helpers. History is matched by person (identity.person_ids), never
by driver code: codes are labels, VER is Vergne and Verstappen."""
from collections import defaultdict
from datetime import date
from typing import Any

from src.utils.identity import person_ids
from src.utils.math_utils import normalize_minmax, clamp

# Weight of the circuit-category signal vs season car_performance_score, ramping in
# as more same-category races are observed (w = 0 until a team has >=2 such races).
CAR_CIRCUIT_BLEND_MAX = 0.35
CAR_CIRCUIT_MIN_RACES = 2
CAR_CIRCUIT_RAMP_RACES = 6

# (driver row on this grid, any row of the same person) pairs, as two parallel id lists for unnest().
SamePerson = tuple[list[int], list[int]]
_SAME_PERSON = "unnest(%s::int[], %s::int[]) AS same(driver_id, hist_id)"


def same_person_rows(conn: Any, driver_ids: list[int]) -> SamePerson:
    with conn.cursor() as cur:
        cur.execute("SELECT d.id, d.code, d.first_name, d.last_name FROM drivers d")
        person = person_ids(cur.fetchall())
    wanted = {person[d] for d in driver_ids if d in person}
    rows_of: dict[str, list[int]] = defaultdict(list)
    for row_id, key in person.items():
        if key in wanted:
            rows_of[key].append(row_id)
    pairs = [(d, h) for d in driver_ids for h in rows_of.get(person.get(d, ""), [d])]
    return [d for d, _ in pairs], [h for _, h in pairs]


def blend_car_perf(season: float, category: float | None, category_races: int) -> float:
    """`category` is None with no history at this circuit category (season signal used
    unchanged); otherwise the category weight ramps 0->max as sample size grows (2..6)."""
    if category is None or category_races < CAR_CIRCUIT_MIN_RACES:
        return clamp(season)
    ramp = (category_races - CAR_CIRCUIT_MIN_RACES) / max(CAR_CIRCUIT_RAMP_RACES - CAR_CIRCUIT_MIN_RACES, 1)
    w = CAR_CIRCUIT_BLEND_MAX * min(1.0, ramp)
    return clamp(season * (1 - w) + category * w)


def compute_team_circuit_perf(
    conn: Any, same: SamePerson, driver_ids: list[int], race_id: int, race_date: date, circuit_category: str,
) -> dict[int, dict]:
    """{driver_id: {"score": 0-1 | None, "n": count}} from this person's earlier races at this circuit
    category, score None below CAR_CIRCUIT_MIN_RACES. high_speed tracks also blend in speed trap pace."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT same.driver_id,
                   AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS cat_avg,
                   COUNT(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS cat_n
            FROM {_SAME_PERSON}
            JOIN race_results rr ON rr.driver_id = same.hist_id
            JOIN races r ON rr.race_id = r.id
            JOIN circuits c ON r.circuit_id = c.id
            WHERE r.status = 'completed' AND r.id != %s AND r.race_date < %s AND c.track_category = %s
            GROUP BY same.driver_id
            """,
            (*same, race_id, race_date, circuit_category),
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
                f"""
                SELECT same.driver_id,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lt.speed_st::numeric) AS med_speed
                FROM {_SAME_PERSON}
                JOIN lap_times lt ON lt.driver_id = same.hist_id
                JOIN races r ON lt.race_id = r.id
                JOIN circuits c ON r.circuit_id = c.id
                WHERE r.status = 'completed' AND r.id != %s AND r.race_date < %s
                  AND c.track_category = 'high_speed'
                  AND lt.speed_st IS NOT NULL AND lt.speed_st > 0
                  AND lt.is_pit_lap = false
                GROUP BY same.driver_id
                """,
                (*same, race_id, race_date),
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


def car_rank(team_id, team_perf: dict) -> float:
    if not team_id:
        return 10.0
    return 20.0 - (team_perf.get(team_id, 0.5) * 19.0)


def compute_luck_score(
    conn: Any, same: SamePerson, driver_ids: list[int], race_date: date, team_perf: dict, stats_rows: dict,
) -> dict[int, float]:
    """Finish position vs expected (avg of grid + car rank) over the person's last 5 completed races."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT driver_id, grid_position, finish_position FROM (
                SELECT same.driver_id, rr.grid_position, rr.finish_position,
                       ROW_NUMBER() OVER (PARTITION BY same.driver_id ORDER BY r.race_date DESC) AS rn
                FROM {_SAME_PERSON}
                JOIN race_results rr ON rr.driver_id = same.hist_id
                JOIN races r ON rr.race_id = r.id
                WHERE r.status = 'completed' AND r.race_date < %s AND rr.finish_position IS NOT NULL
            ) t WHERE rn <= 5
            """,
            (*same, race_date),
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
    field, reducing it further."""
    return clamp(start_pos * (1 + (1 - overtake_rate)) * (1 - 0.3 * sc_probability))


# Statuses whose weekend has run Sprint Qualifying, this one included: its SQ is known before the sprint.
_SQ_RUN = ["sprint_qualifying_done", "sprint_done", "qualifying_done", "completed"]


def compute_rolling_teammate_delta(
    conn: Any, same: SamePerson, driver_ids: list[int], race_date: date,
) -> dict[int, float]:
    """Weighted mean (recent=5..oldest=1) Sprint Qualifying gap to the team-mate over the person's last 5
    sprint weekends, this one included."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT sub.driver_id, sub.team_id, sub.best_ms, sub.race_date,
                   ROW_NUMBER() OVER (PARTITION BY sub.driver_id ORDER BY sub.race_date DESC) AS rn
            FROM (
                SELECT same.driver_id, d_hist.team_id,
                       LEAST(NULLIF(sr.sq3_time_ms,0), NULLIF(sr.sq2_time_ms,0), NULLIF(sr.sq1_time_ms,0)) AS best_ms,
                       r.race_date
                FROM {_SAME_PERSON}
                JOIN drivers d_hist ON d_hist.id = same.hist_id
                JOIN sprint_results sr ON sr.driver_id = same.hist_id
                JOIN races r ON sr.race_id = r.id
                WHERE r.race_date <= %s AND r.status::text = ANY(%s)
            ) sub
            WHERE sub.best_ms IS NOT NULL
            """,
            (*same, race_date, _SQ_RUN),
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
