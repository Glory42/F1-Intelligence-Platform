import fastf1
from src.db.client import get_conn
from src.utils.driver_registry import register_session_drivers, session_entries


def run(year: int, round_num: int = 1) -> None:
    """
    Syncs teams and drivers from a specific round's session data.
    Ingest jobs register later arrivals themselves; re-run with a later round to refresh team moves.
    """
    print(f"[sync_season] year={year} round={round_num}")

    session = fastf1.get_session(year, round_num, "R")
    session.load(laps=False, telemetry=False, weather=False, messages=False)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM seasons WHERE year = %s", (year,))
            row = cur.fetchone()
        if not row:
            raise ValueError(f"Season {year} not found")

        driver_map = register_session_drivers(conn, row["id"], session_entries(session), update_existing=True)
        conn.commit()
        print(f"  Synced {len(driver_map)} drivers")
    finally:
        conn.close()
