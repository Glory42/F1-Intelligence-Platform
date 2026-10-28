"""
Legacy race ingest for pre-2018 seasons.
Uses Ergast data via FastF1: no lap timing data, results only.
"""
import fastf1
import pandas as pd
from typing import Any
from src.db.client import get_conn
from src.utils.upsert import upsert
from src.utils.fastf1_session import ms_to_int as _ms
from src.utils.driver_registry import season_drivers


def _get_session(year: int, round_num: int) -> Any:
    session = fastf1.get_session(year, round_num, "R")
    # Skip laps: pre-2018 has no timing data, loading saves time.
    # Disable weather to avoid 403/404 on Formula 1's live timing server for older years.
    session.load(laps=False, telemetry=False, weather=False, messages=False)
    return session


def run(year: int, round_num: int) -> None:
    print(f"[ingest_race_legacy] year={year} round={round_num}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id FROM races r "
                "JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race_row = cur.fetchone()
        if not race_row:
            raise ValueError(f"Race not found for year={year} round={round_num}")

        race_id = race_row["id"]
        season_id = race_row["season_id"]

        driver_map = season_drivers(conn, season_id).by_code

        session = _get_session(year, round_num)

        if session.results is None or session.results.empty:
            raise RuntimeError("Race results not available")

        # Weather: best effort
        weather = "dry"
        try:
            w = session.weather_data
            if not w.empty and "Rainfall" in w:
                avg_rain = w["Rainfall"].mean()
                weather = "wet" if avg_rain > 0.5 else "mixed" if avg_rain > 0.1 else "dry"
        except Exception:
            pass

        results_to_upsert = []
        for _, row in session.results.iterrows():
            code = row.get("Abbreviation")
            if not code or pd.isna(code) or str(code).strip() == "":
                last_name = row.get("LastName", "")
                first_name = row.get("FirstName", "")
                code = "".join(c for c in str(last_name) if c.isalpha())[:3].upper() if not pd.isna(last_name) and last_name else "".join(c for c in str(first_name) if c.isalpha())[:3].upper()
                if len(code) < 3:
                    num = row.get("DriverNumber", row.get("number", "0"))
                    code = (code + str(num))[:3].upper()
            code = str(code).upper()[:3]

            driver_id = driver_map.get(code)
            if not driver_id:
                print(f"  [warn] Unknown driver: {code}")
                continue

            finish_pos = None
            if not pd.isna(row.get("Position")):
                finish_pos = int(row["Position"])

            grid_pos = 20
            if not pd.isna(row.get("GridPosition")):
                grid_pos = int(row["GridPosition"])

            points = 0.0
            if not pd.isna(row.get("Points")):
                points = float(row["Points"])

            results_to_upsert.append({
                "race_id": race_id,
                "driver_id": driver_id,
                "finish_position": finish_pos,
                "grid_position": grid_pos,
                "points": points,
                "status": str(row.get("Status", "Unknown")),
                "total_race_time_ms": _ms(row.get("Time")),
                "fastest_lap": False,  # not available via Ergast
            })

        if not results_to_upsert:
            raise RuntimeError(f"No results inserted for race {race_id}: all drivers unknown; sync_season may not have run")

        upsert(conn, "race_results", results_to_upsert, ["race_id", "driver_id"])
        print(f"  Upserted {len(results_to_upsert)} race result rows")

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE races SET status = 'completed', weather = %s WHERE id = %s",
                (weather, race_id),
            )
        conn.commit()
        print(f"  Race {race_id} → completed | weather={weather}")

    finally:
        conn.close()
