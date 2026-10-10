import pandas as pd
from src.db.client import get_conn
from src.utils.fastf1_helpers import get_session, ms_to_int
from src.utils.upsert import upsert
from src.utils.driver_map import build_driver_code_map

# Normalise all compounds to a MEDIUM baseline (ms to add to raw lap time)
# Soft is ~0.5s faster than Medium, Hard is ~0.4s slower
COMPOUND_OFFSET_MS = {
    "SOFT":   500,
    "MEDIUM": 0,
    "HARD":   -400,
}

SPRINT_FORMATS = ("sprint", "sprint_qualifying", "sprint_shootout")


def select_practice_session(event_format: str | None) -> str:
    """Sprint weekends have no FP2 session, so they fall back to FP1 for long-run pace."""
    return "FP1" if (event_format or "conventional") in SPRINT_FORMATS else "FP2"


def _load_practice_session(year: int, round_num: int, event_format: str):
    """Returns (session, session_type) with session_type 'FP2' or 'FP1' per select_practice_session."""
    session_type = select_practice_session(event_format)
    session = get_session(year, round_num, session_type)
    return session, session_type


def run(year: int, round_num: int) -> None:
    print(f"[ingest_fp2] year={year} round={round_num}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.event_format FROM races r "
                "JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race_row = cur.fetchone()
        if not race_row:
            raise ValueError(f"Race not found for year={year} round={round_num}")

        race_id = race_row["id"]
        season_id = race_row["season_id"]

        driver_map = build_driver_code_map(conn, season_id)
    finally:
        conn.close()

    # Loaded with no connection held: a FastF1 download takes minutes and would keep Neon awake.
    try:
        session, session_type = _load_practice_session(
            year, round_num, race_row.get("event_format") or "conventional"
        )
        if session.laps is None or session.laps.empty:
            print(f"  [SKIP] {session_type} laps not available for {year} round {round_num}")
            return
    except Exception as e:
        print(f"  [SKIP] {session_type} practice session could not be loaded: {e}")
        return

    laps = session.laps
    laps = laps[laps["Compound"].isin(COMPOUND_OFFSET_MS.keys())]
    laps = laps.dropna(subset=["LapTime", "Stint", "Driver", "Compound"])

    rows_to_upsert: list[dict] = []

    for driver_code, driver_laps in laps.groupby("Driver"):
        driver_id = driver_map.get(str(driver_code).upper())
        if not driver_id:
            continue

        # Single fastest lap (best raw time across all compounds)
        session_best_ms: int | None = None
        try:
            valid_times = driver_laps["LapTime"].dropna()
            valid_times = valid_times[valid_times > pd.Timedelta(0)]
            if not valid_times.empty:
                session_best_ms = int(valid_times.min().total_seconds() * 1000)
        except Exception:
            pass

        for stint_num, stint_laps in driver_laps.groupby("Stint"):
            if len(stint_laps) < 5:
                continue

            stint_laps = stint_laps.sort_values("LapNumber")
            # Laps 3 to N-1: skip warm-up and final outlap
            trimmed = stint_laps.iloc[2:-1]
            if len(trimmed) < 3:
                continue

            compound = str(trimmed.iloc[0]["Compound"]).upper()
            offset_ms = COMPOUND_OFFSET_MS.get(compound)
            if offset_ms is None:
                continue

            lap_times_ms = []
            for _, lap in trimmed.iterrows():
                lt = ms_to_int(lap["LapTime"])
                if lt and lt > 0:
                    lap_times_ms.append(lt + offset_ms)

            if not lap_times_ms:
                continue

            lap_times_ms.sort()
            mid = len(lap_times_ms) // 2
            median_ms = (
                lap_times_ms[mid]
                if len(lap_times_ms) % 2 == 1
                else (lap_times_ms[mid - 1] + lap_times_ms[mid]) // 2
            )

            rows_to_upsert.append({
                "race_id": race_id,
                "driver_id": driver_id,
                "compound": compound,
                "session_type": session_type,
                "median_lap_ms": median_ms,
                "stint_length": len(trimmed),
                "fp2_best_lap_ms": session_best_ms,
            })

    # Per (race, driver, compound) keep the best (shortest) median
    seen: dict[tuple, dict] = {}
    for row in rows_to_upsert:
        key = (row["race_id"], row["driver_id"], row["compound"])
        existing = seen.get(key)
        if not existing or (row["median_lap_ms"] or 999999) < (existing["median_lap_ms"] or 999999):
            seen[key] = row

    final_rows = list(seen.values())

    conn = get_conn()
    try:
        if final_rows:
            upsert(conn, "fp2_long_run_times", final_rows, ["race_id", "driver_id", "compound"])
            drivers_covered = len({r["driver_id"] for r in final_rows})
            print(f"  Upserted {len(final_rows)} {session_type} long-run rows for {drivers_covered} drivers")
        else:
            print(f"  No {session_type} long-run stints found (stints < 5 laps or no data)")

        conn.commit()
    finally:
        conn.close()
