"""Rebuilds pre-FastF1 (1980-2017) race and qualifying results from F1DB (CC-BY-4.0): fixes driver
codes, adds missing drivers/teams (stand-ins, drivers lost to the old "NAN" code), upserts every
result and removes ones filed under the wrong driver. Dry run unless --apply. Local only.
Usage: python scripts/backfill_results_from_f1db.py --from 1980 --to 2017 [--apply] [--version V | --f1db-dir DIR]"""
import argparse
import json
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, ".")
sys.path.insert(0, "scripts")

from psycopg2.extras import execute_values

from f1db_release import fetch_release, latest_version
from src.db.client import get_conn
from src.utils.f1db_backfill import SeasonInput, SeasonPlan, plan_season
from src.utils.storage_guard import read_storage_tier
from src.utils.upsert import upsert

LAST_LEGACY_YEAR = 2017

# Every column that references drivers.id (apps/api/src/db/schema/), for merging duplicate rows.
DRIVER_REFERENCES = [
    ("race_results", "driver_id"), ("qualifying_results", "driver_id"), ("sprint_results", "driver_id"),
    ("lap_times", "driver_id"), ("sprint_lap_times", "driver_id"), ("fp2_long_run_times", "driver_id"),
    ("driver_season_stats", "driver_id"), ("driver_prediction_features", "driver_id"),
    ("driver_sprint_features", "driver_id"), ("race_predictions", "predicted_winner_id"),
    ("sprint_predictions", "predicted_winner_id"), ("race_overtakes", "overtaking_driver_id"),
    ("race_overtakes", "overtaken_driver_id"), ("race_pit_stops", "driver_id"), ("race_stints", "driver_id"),
    ("team_radio_clips", "driver_id"), ("race_lap_traces", "driver_id"), ("race_battles", "chaser_driver_id"),
    ("race_battles", "leader_driver_id"), ("qualifying_lap_telemetry", "driver_id"), ("title_odds_drivers", "driver_id"),
]


def load_f1db(directory: Path) -> dict:
    read = lambda name: json.loads((directory / name).read_text())
    by_year = lambda rows: _group(rows, "year")
    return {
        "drivers": {d["id"]: d for d in read("f1db-drivers.json")},
        "constructors": {c["id"]: c for c in read("f1db-constructors.json")},
        "races": by_year(read("f1db-races.json")),
        "race_results": by_year(read("f1db-races-race-results.json")),
        "qualifying": by_year(read("f1db-races-qualifying-results.json")),
    }


def _group(rows: list[dict], key: str) -> dict:
    grouped = defaultdict(list)
    for r in rows:
        grouped[r[key]].append(r)
    return grouped


def season_input(cur, year: int, f1db: dict) -> SeasonInput | None:
    cur.execute("SELECT id FROM seasons WHERE year = %s", (year,))
    season = cur.fetchone()
    if not season:
        return None
    sid = season["id"]
    cur.execute("SELECT id, code, driver_number, first_name, last_name, team_id FROM drivers WHERE season_id = %s", (sid,))
    drivers = cur.fetchall()
    cur.execute("SELECT id, team_key, name FROM teams WHERE season_id = %s ORDER BY id", (sid,))
    teams = cur.fetchall()
    cur.execute("SELECT id, round_number, race_date, status FROM races WHERE season_id = %s AND race_date < current_date", (sid,))
    races = cur.fetchall()
    race_ids = tuple(r["id"] for r in races) or (0,)
    cur.execute("SELECT race_id, driver_id, finish_position, grid_position, points, status, total_race_time_ms, fastest_lap "
                "FROM race_results WHERE race_id IN %s", (race_ids,))
    race_results = cur.fetchall()
    cur.execute("SELECT race_id, driver_id, grid_position, q1_time_ms, q2_time_ms, q3_time_ms "
                "FROM qualifying_results WHERE race_id IN %s", (race_ids,))
    qualifying = cur.fetchall()
    return SeasonInput(
        season_id=sid, drivers=drivers, teams=teams, races=races, race_results=race_results,
        qualifying_results=qualifying, f1db_drivers=f1db["drivers"], f1db_constructors=f1db["constructors"],
        f1db_races={r["round"]: r["date"] for r in f1db["races"][year]},
        f1db_race_results=f1db["race_results"][year], f1db_qualifying=f1db["qualifying"][year],
    )


def describe(year: int, plan: SeasonPlan) -> str:
    new = ", ".join(f"{d.first_name} {d.last_name}" for d in plan.new_drivers[:6])
    more = f" +{len(plan.new_drivers) - 6}" if len(plan.new_drivers) > 6 else ""
    return (f"{year}: codes {len(plan.code_fixes)} | new teams {len(plan.new_teams)} | new drivers {len(plan.new_drivers)}"
            f"{f' ({new}{more})' if new else ''} | race rows changed {plan.changed_race_rows}, deleted {len(plan.race_deletes)}"
            f" | quali rows changed {plan.changed_qualifying_rows}, deleted {len(plan.qualifying_deletes)}"
            f"{f' | merges {plan.merges}' if plan.merges else ''}"
            f"{f' | completes {len(plan.complete_races)} races' if plan.complete_races else ''}"
            f"{f' | UNMATCHED {plan.unmatched_drivers}' if plan.unmatched_drivers else ''}"
            f"{f' | DATE MISMATCH {plan.date_mismatches}' if plan.date_mismatches else ''}")


def apply(conn, season_id: int, plan: SeasonPlan) -> None:
    with conn.cursor() as cur:
        for driver_id, code in plan.code_fixes.items():
            cur.execute("UPDATE drivers SET code = %s WHERE id = %s", (code, driver_id))
        ids: dict = {}
        for t in plan.new_teams:
            cur.execute("INSERT INTO teams (season_id, team_key, name, nationality) VALUES (%s, %s, %s, NULL) RETURNING id",
                        (season_id, t.team_key, t.name))
            ids[("team", t.ref)] = cur.fetchone()["id"]
        for d in plan.new_drivers:
            team_id = ids.get(("team", d.team_ref), d.team_ref)
            cur.execute("INSERT INTO drivers (season_id, team_id, driver_number, code, first_name, last_name, nationality) "
                        "VALUES (%s, %s, %s, %s, %s, %s, NULL) RETURNING id",
                        (season_id, team_id, d.driver_number, d.code, d.first_name, d.last_name))
            ids[("driver", d.ref)] = cur.fetchone()["id"]
        for table, deletes in (("race_results", plan.race_deletes), ("qualifying_results", plan.qualifying_deletes)):
            if deletes:
                execute_values(cur, f"DELETE FROM {table} WHERE (race_id, driver_id) IN (VALUES %s)", deletes)

        if plan.merges:
            # Their results were just deleted above; any other reference makes this fail and roll back.
            cur.execute("DELETE FROM drivers WHERE id IN %s", (tuple(plan.merges),))
        if plan.complete_races:
            cur.execute("UPDATE races SET status = 'completed' WHERE id IN %s", (tuple(plan.complete_races),))

    resolve = lambda ref: ids.get(("driver", ref), ref)
    for table, rows in (("race_results", plan.race_rows), ("qualifying_results", plan.qualifying_rows)):
        resolved = [{**{k: v for k, v in r.items() if k != "driver_ref"}, "driver_id": resolve(r["driver_ref"])} for r in rows]
        if resolved:
            upsert(conn, table, resolved, ["race_id", "driver_id"])
    conn.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", type=int, required=True)
    parser.add_argument("--to", dest="end", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--version", default=None)
    parser.add_argument("--f1db-dir", default=None, help="an already verified, extracted release")
    args = parser.parse_args()
    if args.end > LAST_LEGACY_YEAR:
        raise SystemExit(f"F1DB only backfills up to {LAST_LEGACY_YEAR}; later seasons re-ingest from FastF1")

    with tempfile.TemporaryDirectory(prefix="f1db-") as tmp:
        directory = Path(args.f1db_dir) if args.f1db_dir else fetch_release(args.version or latest_version(), Path(tmp))
        f1db = load_f1db(directory)

    conn = get_conn()
    try:
        if args.apply and not read_storage_tier(conn).allows_backfill:
            raise SystemExit("storage_guard: Neon storage too full for a backfill")
        for year in range(args.start, args.end + 1):
            with conn.cursor() as cur:
                data = season_input(cur, year, f1db)
            if data is None:
                continue
            plan = plan_season(data)
            print(describe(year, plan), flush=True)
            if plan.merges:
                with conn.cursor() as cur:
                    for table, column in DRIVER_REFERENCES:
                        cur.execute(f"SELECT count(*) AS n FROM {table} WHERE {column} IN %s", (tuple(plan.merges),))
                        n = cur.fetchone()["n"]
                        if n:
                            print(f"    merge refs: {table}.{column} = {n}", flush=True)
            if not args.apply:
                continue
            if plan.unmatched_drivers or plan.date_mismatches:
                print(f"  skipped {year}: resolve the unmatched drivers / date mismatches first", flush=True)
                conn.rollback()
                continue
            apply(conn, data.season_id, plan)
            print(f"  applied {year}", flush=True)
        if not args.apply:
            conn.rollback()
    finally:
        conn.close()
