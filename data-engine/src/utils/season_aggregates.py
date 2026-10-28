"""Season aggregates shared by compute_season_stats (whole season so far) and the sprint feature job
(as of a race date). A feature row must only see races before the one it predicts, otherwise a
recomputed past prediction already knows its own result."""
from datetime import date
from typing import Any, Optional

from src.utils.math_utils import clamp, normalize_minmax


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


def _before_clause(before: Optional[date]) -> tuple[str, tuple]:
    if before is None:
        return "", ()
    return " AND r.race_date < %s", (before,)


def driver_race_aggregates(conn: Any, season_id: int, before: Optional[date] = None) -> list[dict[str, Any]]:
    # DNF filter excludes lead-lap finishes ('Finished'), FastF1 lapped finishes ('Lapped'),
    # and Ergast lapped finishes ('+%').
    clause, params = _before_clause(before)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                d.id AS driver_id,
                d.team_id,
                COUNT(rr.id) AS races_entered,
                COUNT(rr.id) FILTER (WHERE rr.finish_position IS NOT NULL) AS races_finished,
                COUNT(rr.id) FILTER (WHERE rr.finish_position = 1) AS wins,
                COUNT(rr.id) FILTER (WHERE rr.finish_position <= 3) AS podiums,
                COUNT(rr.id) FILTER (WHERE rr.status NOT IN ('Finished', 'Lapped') AND rr.status NOT LIKE '+%%') AS dnf_count,
                COALESCE(SUM(rr.points::numeric), 0) AS total_points,
                AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS avg_finish,
                AVG(rr.grid_position - rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS avg_gain
            FROM drivers d
            JOIN races r ON r.season_id = d.season_id
            JOIN race_results rr ON rr.race_id = r.id AND rr.driver_id = d.id
            WHERE d.season_id = %s AND r.status = 'completed'{clause}
            GROUP BY d.id
            """,
            (season_id, *params),
        )
        return cur.fetchall()


def driver_sprint_aggregates(conn: Any, season_id: int, before: Optional[date] = None) -> dict[int, dict[str, Any]]:
    # Only counts rows where the sprint actually ran (status != 'grid_set')
    clause, params = _before_clause(before)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                d.id AS driver_id,
                COUNT(sr.id) AS sprint_races_entered,
                COUNT(sr.id) FILTER (WHERE sr.finish_position = 1) AS sprint_wins,
                COUNT(sr.id) FILTER (WHERE sr.finish_position <= 3) AS sprint_podiums,
                COALESCE(SUM(sr.points::numeric), 0) AS sprint_total_points,
                AVG(sr.finish_position) FILTER (WHERE sr.finish_position IS NOT NULL) AS sprint_avg_finish
            FROM drivers d
            JOIN races r ON r.season_id = d.season_id
            JOIN sprint_results sr ON sr.race_id = r.id AND sr.driver_id = d.id
            WHERE d.season_id = %s
              AND r.status IN ('sprint_done', 'qualifying_done', 'completed')
              AND sr.status != 'grid_set'{clause}
            GROUP BY d.id
            """,
            (season_id, *params),
        )
        return {r["driver_id"]: r for r in cur.fetchall()}


def team_race_aggregates(conn: Any, season_id: int, before: Optional[date] = None) -> list[dict[str, Any]]:
    clause, params = _before_clause(before)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                t.id AS team_id,
                COUNT(DISTINCT r.id) AS races_completed,
                COUNT(rr.id) FILTER (WHERE rr.finish_position = 1) AS wins,
                COUNT(rr.id) FILTER (WHERE rr.finish_position <= 3) AS podiums,
                COUNT(rr.id) FILTER (WHERE rr.status NOT IN ('Finished', 'Lapped') AND rr.status NOT LIKE '+%%') AS dnf_count,
                COUNT(rr.id) AS total_entries,
                COALESCE(SUM(rr.points::numeric), 0) AS total_points,
                AVG(rr.finish_position) FILTER (WHERE rr.finish_position IS NOT NULL) AS avg_finish,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rr.finish_position) AS median_finish,
                AVG(rr.grid_position) FILTER (WHERE rr.grid_position IS NOT NULL) AS avg_grid
            FROM teams t
            JOIN drivers d ON d.team_id = t.id AND d.season_id = t.season_id
            JOIN races r ON r.season_id = t.season_id AND r.status = 'completed'
            JOIN race_results rr ON rr.race_id = r.id AND rr.driver_id = d.id
            WHERE t.season_id = %s{clause}
            GROUP BY t.id
            """,
            (season_id, *params),
        )
        return cur.fetchall()


def dnf_rate(races_entered: int, dnf_count: int) -> Optional[float]:
    return round(dnf_count / races_entered, 3) if races_entered > 0 else None


def team_scores(team_aggs: list[dict[str, Any]]) -> dict[int, dict[str, float]]:
    """team_id → car_perf and reliability, rounded as team_season_stats stores them. Car perf
    blends median-finish pace (outlier-robust) with grid pace (raw speed); scoring is 50%
    relative min-max + 50% absolute to avoid runaway gaps between top constructors."""
    if not team_aggs:
        return {}
    pace_signal = [
        21.0 - (float(t["median_finish"]) if t["median_finish"] is not None else 21.0) for t in team_aggs
    ]
    grid_signal = [21.0 - (float(t["avg_grid"]) if t["avg_grid"] is not None else 21.0) for t in team_aggs]
    car_perf = compute_compressed_car_perf(pace_signal, grid_signal)
    return {
        t["team_id"]: {
            "car_perf": round(car_perf[i], 5),
            "reliability": round(1.0 - (int(t["dnf_count"]) / max(int(t["total_entries"]), 1)), 5),
        }
        for i, t in enumerate(team_aggs)
    }


def driver_feature_stats(
    race_aggs: list[dict[str, Any]], sprint_aggs: dict[int, dict[str, Any]]
) -> dict[int, dict[str, Any]]:
    """driver_id → the season fields the feature jobs read, shaped like a driver_season_stats row."""
    out = {}
    for d in race_aggs:
        races_entered = int(d["races_entered"])
        sprint = sprint_aggs.get(d["driver_id"])
        out[d["driver_id"]] = {
            "driver_id": d["driver_id"],
            "team_id": d["team_id"],
            "races_entered": races_entered,
            "wins": int(d["wins"]),
            "total_points": float(d["total_points"]),
            "avg_position_gain": round(float(d["avg_gain"]), 2) if d["avg_gain"] is not None else None,
            "dnf_rate": dnf_rate(races_entered, int(d["dnf_count"])),
            "sprint_races_entered": int(sprint["sprint_races_entered"]) if sprint else 0,
            "sprint_wins": int(sprint["sprint_wins"]) if sprint else 0,
            "sprint_total_points": float(sprint["sprint_total_points"]) if sprint else 0.0,
        }
    return out
