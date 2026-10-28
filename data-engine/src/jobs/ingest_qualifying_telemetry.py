from datetime import datetime, timezone

from psycopg2.extras import Json

from src.db.client import get_conn
from src.enrichment_coverage import CONFLICT_KEYS
from src.session_kind import OPENF1_READY_AFTER_QUALIFYING_START
from src.utils.driver_registry import season_drivers
from src.utils.openf1_client import OpenF1BudgetExceeded
from src.utils.openf1_session import fastest_laps, lap_samples, load_session
from src.utils.storage_guard import read_storage_tier
from src.utils.telemetry import build_lap_telemetry, telemetry_samples
from src.utils.upsert import upsert

_DATE_COLUMNS = {"Q": "qualifying_date", "SQ": "sprint_qualifying_date"}


def run(year: int, round_num: int, session_type: str = "Q") -> bool:
    """Stores each driver's fastest lap telemetry. Resumable: drivers already stored are skipped,
    and if the cycle's OpenF1 request budget runs out it writes what it has: later cycles finish.
    Returns False while there is more to fetch later (not ready yet, or the budget ran out)."""
    print(f"[ingest_qualifying_telemetry] year={year} round={round_num} session={session_type}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.race_date, r.status, r.qualifying_date, r.sprint_qualifying_date, "
                "       c.track_length_km "
                "FROM races r JOIN seasons s ON r.season_id = s.id JOIN circuits c ON r.circuit_id = c.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race = cur.fetchone()
            if race is None:
                raise ValueError(f"Race not found for year={year} round={round_num}")
            cur.execute(
                "SELECT driver_id FROM qualifying_lap_telemetry WHERE race_id = %s AND session_type = %s",
                (race["id"], session_type),
            )
            stored = {r["driver_id"] for r in cur.fetchall()}
        session_date = race[_DATE_COLUMNS[session_type]]
        if session_date is None or datetime.now(timezone.utc) - session_date < OPENF1_READY_AFTER_QUALIFYING_START:
            print(f"  [SKIP] {session_type} session not held or not yet past OpenF1's live window")
            return session_date is None
        if not read_storage_tier(conn).allows_optional:
            print("  [SKIP] Neon storage tier blocks optional enrichment")
            return True
        drivers = season_drivers(conn, race["season_id"])
    finally:
        conn.close()

    track_length_m = float(race["track_length_km"]) * 1000
    rows = []
    finished = True
    try:
        session = load_session(year, race["race_date"], session_type, ("laps",))
        laps = sorted(fastest_laps(session).items(), key=lambda kv: kv[1].lap_ms)
        for driver_number, window in laps:
            driver_id = drivers.id_for(driver_number)
            if driver_id is None or driver_id in stored:
                continue
            car, location = lap_samples(session.session_key, driver_number, window)
            if len(location) < 2:
                continue
            try:
                telemetry = build_lap_telemetry(car, location, window, track_length_m)
            except ValueError as e:
                print(f"  [SKIP] driver {driver_number}: {e}")
                continue
            rows.append({
                "race_id": race["id"], "session_type": session_type, "driver_id": driver_id,
                "lap_number": window.lap_number, "lap_time_ms": window.lap_ms,
                "samples": Json(telemetry_samples(telemetry)),
            })
    except OpenF1BudgetExceeded:
        finished = False
        print(f"  OpenF1 request budget spent after {len(rows)} drivers: the rest resume next cycle")

    if not rows:
        return finished
    conn = get_conn()
    try:
        upsert(conn, "qualifying_lap_telemetry", rows, CONFLICT_KEYS["qualifying_lap_telemetry"])
        print(f"  Upserted {len(rows)} lap telemetry rows")
    finally:
        conn.close()
    return finished
