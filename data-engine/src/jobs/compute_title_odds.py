from collections import defaultdict

import numpy as np

from src.db.client import get_conn
from src.utils.title_odds import build_remaining_races, simulate_season_totals, summarize_totals
from src.utils.upsert import upsert

SIMULATIONS = 10_000
MODEL_VERSION = "title-odds-v1"


def _probabilities_by_race(rows: list[dict]) -> dict[int, dict[int, float]]:
    by_race: dict[int, dict[int, float]] = defaultdict(dict)
    for r in rows:
        by_race[r["race_id"]][r["driver_id"]] = float(r["win_probability"])
    return dict(by_race)


def _odds_rows(key: str, ids: list[int], odds, season_id: int, after_round: int) -> list[dict]:
    return [
        {
            "season_id": season_id, "after_round": after_round, key: entity_id,
            "title_probability": round(float(odds.title_probability[i]), 5),
            "expected_points": round(float(odds.expected_points[i]), 1),
            "points_p10": round(float(odds.points_p10[i]), 1),
            "points_p90": round(float(odds.points_p90[i]), 1),
            "simulations": SIMULATIONS, "model_version": MODEL_VERSION,
        }
        for i, entity_id in enumerate(ids)
    ]


_LIVE_STANDINGS = (
    "SELECT d.id AS driver_id, d.team_id, "
    "COALESCE(s.total_points, 0) + COALESCE(s.sprint_total_points, 0) AS points "
    "FROM drivers d LEFT JOIN driver_season_stats s ON s.driver_id = d.id AND s.season_id = d.season_id "
    "WHERE d.season_id = %(season_id)s ORDER BY d.id"
)
# Points scored up to and including one round, for replaying the title race as it stood then.
_STANDINGS_AFTER_ROUND = (
    "SELECT d.id AS driver_id, d.team_id, COALESCE(gp.points, 0) + COALESCE(sp.points, 0) AS points "
    "FROM drivers d "
    "LEFT JOIN (SELECT rr.driver_id, SUM(rr.points::numeric) AS points FROM race_results rr "
    "  JOIN races r ON r.id = rr.race_id WHERE r.season_id = %(season_id)s AND r.round_number <= %(after_round)s "
    "  GROUP BY rr.driver_id) gp ON gp.driver_id = d.id "
    "LEFT JOIN (SELECT sr.driver_id, SUM(sr.points::numeric) AS points FROM sprint_results sr "
    "  JOIN races r ON r.id = sr.race_id WHERE r.season_id = %(season_id)s AND r.round_number <= %(after_round)s "
    "  GROUP BY sr.driver_id) sp ON sp.driver_id = d.id "
    "WHERE d.season_id = %(season_id)s ORDER BY d.id"
)


def _as_of_round(races: list[dict], predictions: dict[int, dict[int, float]], after_round: int):
    """The season as it stood after `after_round`: later races still to run, and only the
    predictions that existed by then (the live job never sees a prediction before qualifying)."""
    known = {r["id"] for r in races if r["round_number"] <= after_round}
    replayed = [{**r, "status": "completed" if r["id"] in known else "scheduled"} for r in races]
    return replayed, {race_id: p for race_id, p in predictions.items() if race_id in known}


def run(year: int, after_round: int | None = None) -> None:
    """Title odds after the latest completed round, or after `after_round` when replaying history."""
    print(f"[compute_title_odds] year={year}" + (f" after_round={after_round}" if after_round else ""))
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM seasons WHERE year = %s", (year,))
            season_id = cur.fetchone()["id"]
            params = {"season_id": season_id, "after_round": after_round}
            cur.execute(_LIVE_STANDINGS if after_round is None else _STANDINGS_AFTER_ROUND, params)
            standings = cur.fetchall()
            cur.execute(
                "SELECT id, round_number, status, event_format FROM races WHERE season_id = %s ORDER BY round_number",
                (season_id,),
            )
            races = cur.fetchall()
            race_ids = [r["id"] for r in races]
            cur.execute(
                "SELECT race_id, driver_id, win_probability FROM driver_prediction_features "
                "WHERE race_id = ANY(%s) AND win_probability IS NOT NULL",
                (race_ids,),
            )
            gp_predictions = _probabilities_by_race(cur.fetchall())
            cur.execute(
                "SELECT race_id, driver_id, win_probability FROM driver_sprint_features "
                "WHERE race_id = ANY(%s) AND win_probability IS NOT NULL",
                (race_ids,),
            )
            sprint_predictions = _probabilities_by_race(cur.fetchall())

        if after_round is None:
            after_round = max((r["round_number"] for r in races if r["status"] == "completed"), default=0)
        else:
            races, gp_predictions = _as_of_round(races, gp_predictions, after_round)
            sprint_predictions = {k: v for k, v in sprint_predictions.items() if k in gp_predictions}
        driver_ids = [s["driver_id"] for s in standings]
        points = np.array([float(s["points"]) for s in standings])
        remaining = build_remaining_races(races, gp_predictions, sprint_predictions, driver_ids)
        # Seeded per (season, round) so re-running a job reproduces identical odds (idempotent ETL).
        totals = simulate_season_totals(points, remaining, n=SIMULATIONS, seed=year * 100 + after_round)
        team_ids = sorted({s["team_id"] for s in standings})
        membership = np.array([[s["team_id"] == t for s in standings] for t in team_ids], dtype=float)
        driver_odds = summarize_totals(totals)
        team_odds = summarize_totals(totals @ membership.T)

        upsert(conn, "title_odds_drivers", _odds_rows("driver_id", driver_ids, driver_odds, season_id, after_round),
               ["season_id", "after_round", "driver_id"])
        upsert(conn, "title_odds_teams", _odds_rows("team_id", team_ids, team_odds, season_id, after_round),
               ["season_id", "after_round", "team_id"])
        print(f"  Title odds after round {after_round}: {len(driver_ids)} drivers, {len(team_ids)} teams")
    finally:
        conn.close()
