"""Pre-2018 qualifying via Ergast/FastF1: pre-2006 is single-lap (no Q1/Q2/Q3);
2006+ uses the Q1/Q2/Q3 format."""
import fastf1
import pandas as pd
from typing import Any
from src.db.client import get_conn
from src.utils.upsert import upsert
from src.utils.fastf1_session import ms_to_int as _ms
from src.utils.driver_registry import season_drivers


def _get_session(year: int, round_num: int) -> Any:
    session = fastf1.get_session(year, round_num, "Q")
    session.load(laps=False, telemetry=False, weather=False, messages=False)
    return session


def run(year: int, round_num: int) -> None:
    print(f"[ingest_qualifying_legacy] year={year} round={round_num}")

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

        results_df = session.results
        is_fallback = False
        if results_df is None or results_df.empty:
            print("  No qualifying results in Ergast: falling back to race grid positions")
            race_session = fastf1.get_session(year, round_num, "R")
            race_session.load(laps=False, telemetry=False, weather=False, messages=False)
            results_df = race_session.results
            is_fallback = True

        if results_df is None or results_df.empty:
            print("  No qualifying or race data available: skipping")
            return

        rows_to_upsert = []
        for _, row in results_df.iterrows():
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

            if is_fallback:
                if pd.isna(row.get("GridPosition")):
                    continue
                grid_pos = int(row["GridPosition"])
            else:
                if pd.isna(row.get("Position")):
                    continue
                grid_pos = int(row["Position"])

            # Q1/Q2/Q3 available from 2006+ via Ergast
            q1 = _ms(row.get("Q1"))
            q2 = _ms(row.get("Q2"))
            q3 = _ms(row.get("Q3"))

            # Pre-2006: single best lap → store as Q1
            if q1 is None and q2 is None and q3 is None:
                q1 = _ms(row.get("Time"))

            rows_to_upsert.append({
                "race_id": race_id,
                "driver_id": driver_id,
                "grid_position": grid_pos,
                "q1_time_ms": q1,
                "q2_time_ms": q2,
                "q3_time_ms": q3,
                "sector1_ms": None,
                "sector2_ms": None,
                "sector3_ms": None,
                "speed_st": None,
            })

        if rows_to_upsert:
            upsert(conn, "qualifying_results", rows_to_upsert, ["race_id", "driver_id"])
            print(f"  Upserted {len(rows_to_upsert)} qualifying rows")

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE races SET status = 'qualifying_done' WHERE id = %s AND status = 'scheduled'",
                (race_id,),
            )
        conn.commit()

    finally:
        conn.close()
