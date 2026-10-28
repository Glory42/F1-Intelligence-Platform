from src.db.client import get_conn
from src.utils.driver_registry import register_session_drivers
from src.utils.openf1_session import load_session, session_entries


def run(year: int, round_num: int = 1) -> None:
    """
    Syncs teams and drivers from a specific round's race entry list.
    Ingest jobs register later arrivals themselves; re-run with a later round to refresh team moves.
    """
    print(f"[sync_season] year={year} round={round_num}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT s.id AS season_id, r.race_date FROM seasons s "
                "LEFT JOIN races r ON r.season_id = s.id AND r.round_number = %s WHERE s.year = %s",
                (round_num, year),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        raise ValueError(f"Season {year} not found")
    if row["race_date"] is None:
        raise ValueError(f"Round {round_num} of {year} is not on the calendar: run sync_schedule first")

    session = load_session(year, row["race_date"], "R", ("drivers",))

    conn = get_conn()
    try:
        driver_map = register_session_drivers(conn, row["season_id"], session_entries(session), update_existing=True)
        conn.commit()
        print(f"  Synced {len(driver_map)} drivers")
    finally:
        conn.close()
