from dataclasses import dataclass
from typing import Any, Callable

from src.utils.season_aggregates import (
    driver_feature_stats,
    driver_race_aggregates,
    driver_sprint_aggregates,
    team_race_aggregates,
    team_scores,
)


@dataclass
class FeatureContext:
    """Shared pre-divergence context for the GP and sprint feature jobs. Grid source
    differs by model, so build_feature_context() takes it as a parameter."""

    race_id: int
    season_id: int
    circuit_id: int
    event_format: str | None
    overtake_rate: float
    sc_probability: float
    circuit_category: str | None
    driver_ids: list[int]
    grid_map: dict[int, int]
    start_pos_map: dict[int, float]
    stats_rows: dict[int, dict[str, Any]]
    team_data: dict[int, dict[str, float]]
    team_perf: dict[int, float]


def build_feature_context(
    conn: Any,
    race_id: int,
    *,
    grid_table: str,
    grid_not_found_message: str,
    validate_race: Callable[[dict[str, Any]], None] | None = None,
) -> FeatureContext:
    """`grid_table` is `qualifying_results` (GP) or `sprint_results` (sprint). `validate_race`
    runs before the grid lookup so its error outranks a "no grid rows" error."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.race_date, r.circuit_id, r.event_format, "
            "       c.overtake_rate, c.sc_probability, c.track_category "
            "FROM races r JOIN circuits c ON r.circuit_id = c.id "
            "WHERE r.id = %s",
            (race_id,),
        )
        race = cur.fetchone()
    if not race:
        raise ValueError(f"Race {race_id} not found")

    if validate_race is not None:
        validate_race(race)

    season_id = race["season_id"]
    overtake_rate = float(race["overtake_rate"]) if race["overtake_rate"] is not None else 0.5
    sc_probability = float(race["sc_probability"]) if race["sc_probability"] is not None else 0.3

    with conn.cursor() as cur:
        cur.execute(
            f"SELECT g.driver_id, g.grid_position FROM {grid_table} g WHERE g.race_id = %s",
            (race_id,),
        )
        grid_rows = cur.fetchall()

    if not grid_rows:
        raise ValueError(grid_not_found_message)

    driver_ids = [r["driver_id"] for r in grid_rows]
    grid_map = {r["driver_id"]: r["grid_position"] for r in grid_rows}
    start_pos_map = {d: (21 - grid_map.get(d, 20)) / 20.0 for d in driver_ids}

    # As of the race date, not the stored season rows: a recomputed past race must not see its own result.
    before = race["race_date"]
    season_stats = driver_feature_stats(
        driver_race_aggregates(conn, season_id, before),
        driver_sprint_aggregates(conn, season_id, before),
    )
    stats_rows = {d: season_stats[d] for d in driver_ids if d in season_stats}
    team_data = team_scores(team_race_aggregates(conn, season_id, before))

    team_perf = {tid: v["car_perf"] for tid, v in team_data.items()}

    return FeatureContext(
        race_id=race_id,
        season_id=season_id,
        circuit_id=race["circuit_id"],
        event_format=race["event_format"],
        overtake_rate=overtake_rate,
        sc_probability=sc_probability,
        circuit_category=race.get("track_category"),
        driver_ids=driver_ids,
        grid_map=grid_map,
        start_pos_map=start_pos_map,
        stats_rows=stats_rows,
        team_data=team_data,
        team_perf=team_perf,
    )
