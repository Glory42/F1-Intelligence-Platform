"""The slice of the database the v4 features read, loaded once into memory. The live feature job loads
the last few seasons for one race; the backtest loads the whole snapshot and replays every race from it,
so both run the same feature code."""
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from src.utils.identity import constructor_key, person_ids


@dataclass
class RaceHistory:
    races: dict[int, dict[str, Any]]           # race id → id, race_date, year, status, event_format,
    #                                            circuit_id, overtake_rate, neutralised (SC/VSC shown)
    results: dict[int, list[dict[str, Any]]]   # race id → driver_id, team_id, grid_position, finish_position, status
    quali: dict[int, list[dict[str, Any]]]     # race id → driver_id, team_id, grid_position, q1/q2/q3_time_ms
    long_runs: dict[int, list[dict[str, Any]]]  # race id → driver_id, compound, median_lap_ms
    sprints: dict[int, list[dict[str, Any]]]   # race id → driver_id, finish_position, status
    race_pace: dict[int, list[dict[str, Any]]]  # race id → driver_id, median_lap_ms of clean race laps
    person: dict[int, str]                     # driver row id → one key per person across seasons
    outfit: dict[int, str]                     # team row id → one key per outfit across rebrands
    team_of: dict[int, int]                    # driver row id → its team row id
    # Per-race summaries the features reuse across many target races (see gp_features_v4).
    memo: dict[Any, Any] = field(default_factory=dict)

    def completed_before(self, race_date: date) -> list[int]:
        """Completed race ids before `race_date`, most recent first."""
        past = [r for r in self.races.values() if r["status"] == "completed" and r["race_date"] < race_date]
        return [r["id"] for r in sorted(past, key=lambda r: r["race_date"], reverse=True)]


def _group(rows: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["race_id"], []).append(r)
    return out


def load_history(conn: Any, since: date, until: Optional[date] = None) -> RaceHistory:
    """Races dated `since`..`until` (inclusive) with their results, qualifying, practice long runs,
    sprint results and race-lap pace, plus every driver and team row of those seasons for identity."""
    until = until or date.max
    window = (since, until)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.race_date, s.year, r.status::text AS status, r.event_format, r.circuit_id, "
            "       c.overtake_rate, (COALESCE(r.safety_car_laps, 0) + COALESCE(r.vsc_laps, 0)) > 0 AS neutralised "
            "FROM races r JOIN seasons s ON s.id = r.season_id JOIN circuits c ON c.id = r.circuit_id "
            "WHERE r.race_date BETWEEN %s AND %s",
            window,
        )
        races = {r["id"]: dict(r) for r in cur.fetchall()}
        cur.execute(
            "SELECT rr.race_id, rr.driver_id, d.team_id, rr.grid_position, rr.finish_position, rr.status "
            "FROM race_results rr JOIN drivers d ON d.id = rr.driver_id JOIN races r ON r.id = rr.race_id "
            "WHERE r.race_date BETWEEN %s AND %s",
            window,
        )
        results = _group(cur.fetchall())
        cur.execute(
            "SELECT qr.race_id, qr.driver_id, d.team_id, qr.grid_position, "
            "       qr.q1_time_ms, qr.q2_time_ms, qr.q3_time_ms "
            "FROM qualifying_results qr JOIN drivers d ON d.id = qr.driver_id JOIN races r ON r.id = qr.race_id "
            "WHERE r.race_date BETWEEN %s AND %s",
            window,
        )
        quali = _group(cur.fetchall())
        cur.execute(
            "SELECT fp.race_id, fp.driver_id, fp.compound, fp.median_lap_ms "
            "FROM fp2_long_run_times fp JOIN races r ON r.id = fp.race_id "
            "WHERE r.race_date BETWEEN %s AND %s AND fp.median_lap_ms IS NOT NULL",
            window,
        )
        long_runs = _group(cur.fetchall())
        cur.execute(
            "SELECT sr.race_id, sr.driver_id, sr.finish_position, sr.status "
            "FROM sprint_results sr JOIN races r ON r.id = sr.race_id "
            "WHERE r.race_date BETWEEN %s AND %s AND sr.status != 'grid_set'",
            window,
        )
        sprints = _group(cur.fetchall())
        # Laps slower than 107% of the race's median are safety-car, traffic or damage laps, not pace.
        cur.execute(
            """
            WITH clean AS (
                SELECT lt.race_id, lt.driver_id, lt.lap_time_ms
                FROM lap_times lt JOIN races r ON r.id = lt.race_id
                WHERE r.race_date BETWEEN %s AND %s
                  AND NOT lt.is_pit_lap AND lt.lap_number > 1 AND lt.lap_time_ms > 0
            ), race_median AS (
                SELECT race_id, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_time_ms) AS ms
                FROM clean GROUP BY race_id
            )
            SELECT c.race_id, c.driver_id,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.lap_time_ms) AS median_lap_ms
            FROM clean c JOIN race_median m ON m.race_id = c.race_id
            WHERE c.lap_time_ms < m.ms * 1.07
            GROUP BY c.race_id, c.driver_id
            HAVING COUNT(*) >= 10
            """,
            window,
        )
        race_pace = _group(cur.fetchall())
        cur.execute(
            "SELECT d.id, d.team_id, d.code, d.first_name, d.last_name FROM drivers d JOIN seasons s ON s.id = d.season_id "
            "WHERE s.year BETWEEN %s AND %s",
            (since.year, until.year),
        )
        drivers = cur.fetchall()
        cur.execute(
            "SELECT t.id, t.team_key FROM teams t JOIN seasons s ON s.id = t.season_id WHERE s.year BETWEEN %s AND %s",
            (since.year, until.year),
        )
        outfit = {t["id"]: constructor_key(t["team_key"]) for t in cur.fetchall()}
    return RaceHistory(
        races=races, results=results, quali=quali, long_runs=long_runs, sprints=sprints, race_pace=race_pace,
        person=person_ids(drivers), outfit=outfit, team_of={d["id"]: d["team_id"] for d in drivers},
    )
