"""Fills the OpenF1-era enrichment tables from FastF1 for seasons OpenF1 doesn't cover: stints,
pit stops (pit-lane time only), race control, and each driver's fastest qualifying lap telemetry.
Skips a table a race already has rows for, so it resumes after a stop and never overwrites
OpenF1 data. Run locally, never on Render (a telemetry load is a few hundred MB).
Usage: python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]
--refresh rewrites the chosen parts even where rows exist (after a converter fix)."""
import argparse
import sys

sys.path.insert(0, ".")

from psycopg2.extras import Json

from src.db.client import get_conn
from src.utils.driver_map import build_driver_code_map
from src.utils.fastf1_enrichment import (
    fastest_lap_inputs, pit_stop_rows, race_control_rows, session_lap_records, session_message_records, stint_rows,
)
from src.utils.storage_guard import read_storage_tier
from src.utils.telemetry import build_lap_telemetry, telemetry_samples
from src.utils.upsert import upsert

import fastf1

PARTS = ("stints", "pits", "race_control", "telemetry")
TABLES = {
    "stints": ("race_stints", ["race_id", "session_type", "driver_id", "stint_number"]),
    "pits": ("race_pit_stops", ["race_id", "session_type", "driver_id", "lap_number"]),
    "race_control": ("race_control_messages", ["race_id", "date", "message"]),
}


def races_with_coverage(start: int, end: int) -> list[dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.id, r.season_id, r.round_number, r.sprint_date, s.year,
                          c.track_length_km,
                          EXISTS (SELECT 1 FROM race_stints t WHERE t.race_id = r.id AND t.session_type = 'race') AS stints_race,
                          EXISTS (SELECT 1 FROM race_stints t WHERE t.race_id = r.id AND t.session_type = 'sprint') AS stints_sprint,
                          EXISTS (SELECT 1 FROM race_pit_stops t WHERE t.race_id = r.id AND t.session_type = 'race') AS pits_race,
                          EXISTS (SELECT 1 FROM race_pit_stops t WHERE t.race_id = r.id AND t.session_type = 'sprint') AS pits_sprint,
                          EXISTS (SELECT 1 FROM race_control_messages t WHERE t.race_id = r.id AND t.session_type = 'race') AS race_control_race,
                          EXISTS (SELECT 1 FROM race_control_messages t WHERE t.race_id = r.id AND t.session_type = 'sprint') AS race_control_sprint,
                          EXISTS (SELECT 1 FROM qualifying_lap_telemetry t WHERE t.race_id = r.id AND t.session_type = 'Q') AS telemetry_q
                   FROM races r
                   JOIN seasons s ON r.season_id = s.id
                   JOIN circuits c ON r.circuit_id = c.id
                   WHERE s.year BETWEEN %s AND %s AND r.status = 'completed'
                   ORDER BY s.year, r.round_number""",
                (start, end),
            )
            return cur.fetchall()
    finally:
        conn.close()


def write(rows_by_table: dict[str, list[dict]]) -> None:
    conn = get_conn()
    try:
        if not read_storage_tier(conn).allows_backfill:
            raise SystemExit("[STOP] Neon storage past the backfill threshold: see storage_guard")
        for table, (rows, conflict) in rows_by_table.items():
            if rows:
                upsert(conn, table, rows, conflict)
        conn.commit()
    finally:
        conn.close()


def code_map_for(season_id: int) -> dict[str, int]:
    conn = get_conn()
    try:
        return build_driver_code_map(conn, season_id)
    finally:
        conn.close()


def backfill_race_session(race: dict, tag: str, parts: set[str], code_map: dict[str, int], refresh: bool) -> None:
    wanted = [p for p in ("stints", "pits", "race_control") if p in parts and (refresh or not race[f"{p}_{tag}"])]
    if not wanted:
        return
    # Loaded with no DB connection open (Neon compute), then one short write.
    session = fastf1.get_session(race["year"], race["round_number"], "R" if tag == "race" else "S")
    session.load(laps=True, telemetry=False, weather=False, messages="race_control" in wanted)
    laps = session_lap_records(session)
    built = {
        "stints": lambda: stint_rows(laps, code_map, race["id"], tag),
        "pits": lambda: pit_stop_rows(laps, code_map, race["id"], tag),
        "race_control": lambda: race_control_rows(session_message_records(session), race["id"], tag),
    }
    rows = {TABLES[p][0]: (built[p](), TABLES[p][1]) for p in wanted}
    write(rows)
    print(f"  {tag}: " + ", ".join(f"{len(r)} {t}" for t, (r, _) in rows.items()))


def backfill_telemetry(race: dict, code_map: dict[str, int]) -> None:
    session = fastf1.get_session(race["year"], race["round_number"], "Q")
    session.load(laps=True, telemetry=True, weather=False, messages=False)
    track_length_m = float(race["track_length_km"]) * 1000
    rows = []
    for code, car, location, window in fastest_lap_inputs(session):
        driver_id = code_map.get(code)
        if driver_id is None:
            continue
        try:
            telemetry = build_lap_telemetry(car, location, window, track_length_m)
        except ValueError as e:
            print(f"  [SKIP] {code}: {e}")
            continue
        rows.append({
            "race_id": race["id"], "session_type": "Q", "driver_id": driver_id, "lap_number": window.lap_number,
            "lap_time_ms": window.lap_ms, "samples": Json(telemetry_samples(telemetry)),
        })
    write({"qualifying_lap_telemetry": (rows, ["race_id", "session_type", "driver_id"])})
    print(f"  Q telemetry: {len(rows)} laps")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("start", type=int, nargs="?", default=2018)
    parser.add_argument("end", type=int, nargs="?", default=2022)
    parser.add_argument("--only", default=",".join(PARTS), help=f"comma-separated subset of {', '.join(PARTS)}")
    parser.add_argument("--cache", default="./cache", help="FastF1 cache directory")
    parser.add_argument("--refresh", action="store_true", help="rewrite even where rows already exist")
    args = parser.parse_args()
    parts = set(args.only.split(","))
    fastf1.Cache.enable_cache(args.cache)

    races = races_with_coverage(args.start, args.end)
    print(f"FastF1 enrichment ({', '.join(sorted(parts))}) for {len(races)} completed races ({args.start}-{args.end})")
    failed = []
    for i, race in enumerate(races, 1):
        print(f"[{i}/{len(races)}] {race['year']} R{race['round_number']:02d}")
        code_map = code_map_for(race["season_id"])
        sessions = ("race", "sprint") if race["sprint_date"] is not None else ("race",)
        for tag in sessions:
            try:
                backfill_race_session(race, tag, parts, code_map, args.refresh)
            except SystemExit:
                raise
            except Exception as e:
                print(f"  [WARN] {tag} failed: {e}")
                failed.append((race["year"], race["round_number"], tag))
        if "telemetry" in parts and (args.refresh or not race["telemetry_q"]):
            try:
                backfill_telemetry(race, code_map)
            except SystemExit:
                raise
            except Exception as e:
                print(f"  [WARN] telemetry failed: {e}")
                failed.append((race["year"], race["round_number"], "telemetry"))
    print(f"\nDone. Failed: {failed or 'none'}")
