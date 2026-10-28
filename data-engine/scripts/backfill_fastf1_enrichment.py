"""Fills the OpenF1-era enrichment tables from FastF1 for the seasons FastF1 serves
(enrichment_coverage.source_for: 2018-2022): stints, pit stops (pit-lane time only), race control,
and each driver's fastest qualifying lap telemetry. Skips what a race's coverage already has, so it
resumes after a stop and never touches OpenF1 seasons. Run locally, never on Render (a telemetry
load is a few hundred MB).
Usage: python scripts/backfill_fastf1_enrichment.py 2018 2022 [--only stints,pits,race_control,telemetry] [--refresh]
--refresh rewrites the chosen parts even where rows exist (after a converter fix)."""
import argparse
import sys

sys.path.insert(0, ".")

from psycopg2.extras import Json

from src.db.client import get_conn
from src.enrichment_coverage import (
    CONFLICT_KEYS, Source, backfill_allowed, coverage_of, read_coverage, source_for, step_name,
)
from src.utils.driver_registry import SeasonDrivers, season_drivers
from src.utils.fastf1_session import (
    fastest_lap_inputs, lap_frame_records, pit_stops, race_control_messages, session_message_records, stints,
)
from src.utils.session_records import pit_stop_rows, race_control_rows, stint_rows
from src.utils.telemetry import build_lap_telemetry, telemetry_samples
from src.utils.upsert import upsert

import fastf1

# Each part stands in for the OpenF1 job that fills the same coverage from 2023.
PARTS = {
    "stints": "ingest_stints",
    "pits": "ingest_pit_stops",
    "race_control": "ingest_race_control",
    "telemetry": "ingest_qualifying_telemetry",
}
SESSION_PARTS = ("stints", "pits", "race_control")


def races_to_fill(start: int, end: int) -> list[dict]:
    conn = get_conn()
    try:
        rows = read_coverage(conn, start, end)
    finally:
        conn.close()
    return [r for r in rows if r["status"] == "completed" and source_for(r["year"]) is Source.FASTF1]


def write(rows_by_table: dict[str, list[dict]]) -> None:
    conn = get_conn()
    try:
        if not backfill_allowed(conn):
            raise SystemExit(1)
        for table, rows in rows_by_table.items():
            if rows:
                upsert(conn, table, rows, CONFLICT_KEYS[table])
        conn.commit()
    finally:
        conn.close()


def drivers_for(season_id: int) -> SeasonDrivers:
    conn = get_conn()
    try:
        return season_drivers(conn, season_id)
    finally:
        conn.close()


def backfill_race_session(race: dict, tag: str, parts: set[str], drivers: SeasonDrivers, refresh: bool) -> None:
    wanted = [p for p in SESSION_PARTS if p in parts and (refresh or not race[step_name(PARTS[p], tag)])]
    if not wanted:
        return
    # Loaded with no DB connection open (Neon compute), then one short write.
    session = fastf1.get_session(race["year"], race["round_number"], "R" if tag == "race" else "S")
    session.load(laps=True, telemetry=False, weather=False, messages="race_control" in wanted)
    laps = lap_frame_records(session)
    built = {
        "stints": lambda: stint_rows(stints(laps), drivers, race["id"], tag),
        "pits": lambda: pit_stop_rows(pit_stops(laps), drivers, race["id"], tag),
        "race_control": lambda: race_control_rows(race_control_messages(session_message_records(session)), drivers,
                                                  race["id"], tag),
    }
    rows = {coverage_of(step_name(PARTS[p], tag)).table: built[p]()[0] for p in wanted}
    write(rows)
    print(f"  {tag}: " + ", ".join(f"{len(r)} {t}" for t, r in rows.items()))


def backfill_telemetry(race: dict, drivers: SeasonDrivers) -> None:
    session = fastf1.get_session(race["year"], race["round_number"], "Q")
    session.load(laps=True, telemetry=True, weather=False, messages=False)
    track_length_m = float(race["track_length_km"]) * 1000
    rows = []
    for code, car, location, window in fastest_lap_inputs(session):
        driver_id = drivers.id_for(code=code)
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
    write({"qualifying_lap_telemetry": rows})
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

    races = races_to_fill(args.start, args.end)
    print(f"FastF1 enrichment ({', '.join(sorted(parts))}) for {len(races)} completed races ({args.start}-{args.end})")
    failed = []
    for i, race in enumerate(races, 1):
        print(f"[{i}/{len(races)}] {race['year']} R{race['round_number']:02d}")
        drivers = drivers_for(race["season_id"])
        sessions = ("race", "sprint") if race["sprint_date"] is not None else ("race",)
        for tag in sessions:
            try:
                backfill_race_session(race, tag, parts, drivers, args.refresh)
            except SystemExit:
                raise
            except Exception as e:
                print(f"  [WARN] {tag} failed: {e}")
                failed.append((race["year"], race["round_number"], tag))
        if "telemetry" in parts and (args.refresh or not race[PARTS["telemetry"]]):
            try:
                backfill_telemetry(race, drivers)
            except SystemExit:
                raise
            except Exception as e:
                print(f"  [WARN] telemetry failed: {e}")
                failed.append((race["year"], race["round_number"], "telemetry"))
    print(f"\nDone. Failed: {failed or 'none'}")
