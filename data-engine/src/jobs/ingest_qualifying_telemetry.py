from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from psycopg2.extras import Json

from src.db.client import get_conn
from src.utils.driver_map import build_driver_number_map
from src.utils.openf1_client import (
    OpenF1BudgetExceeded, fetch_car_data, fetch_laps, fetch_location, get_session_key,
)
from src.utils.storage_guard import read_storage_tier
from src.utils.telemetry import build_lap_telemetry, fastest_laps
from src.utils.upsert import upsert

# OpenF1 session names; 2023's sprint qualifying was called the "Sprint Shootout".
_SESSIONS = {
    "Q": {"names": ("Qualifying",), "date_column": "qualifying_date"},
    "SQ": {"names": ("Sprint Qualifying", "Sprint Shootout"), "date_column": "sprint_qualifying_date"},
}
# OpenF1's free tier only serves a session's data once it's comfortably over.
_READY_AFTER = timedelta(hours=2)


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _resolve_session_key(year: int, session_date, names: tuple[str, ...]) -> int:
    last_error: Exception | None = None
    for name in names:
        try:
            return get_session_key(year, session_date, session_name=name)
        except ValueError as e:
            last_error = e
    raise last_error or ValueError("no OpenF1 session")


def run(year: int, round_num: int, session_type: str = "Q") -> None:
    """Stores each driver's fastest lap telemetry. Resumable: drivers already stored are skipped,
    and if the cycle's OpenF1 request budget runs out it writes what it has — later cycles finish."""
    config = _SESSIONS[session_type]
    print(f"[ingest_qualifying_telemetry] year={year} round={round_num} session={session_type}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.status, r.qualifying_date, r.sprint_qualifying_date, c.track_length_km "
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
        session_date = race[config["date_column"]]
        if session_date is None or datetime.now(timezone.utc) - session_date < _READY_AFTER:
            print(f"  [SKIP] {session_type} session not held or not yet past OpenF1's live window")
            return
        if not read_storage_tier(conn).allows_optional:
            print("  [SKIP] Neon storage tier blocks optional enrichment")
            return
        driver_map = build_driver_number_map(conn, race["season_id"])
    finally:
        conn.close()

    session_key = _resolve_session_key(year, session_date, config["names"])
    track_length_m = float(race["track_length_km"]) * 1000
    rows = []
    try:
        laps = sorted(fastest_laps(fetch_laps(session_key)).items(), key=lambda kv: kv[1].lap_ms)
        for driver_number, window in laps:
            driver_id = driver_map.get(driver_number)
            if driver_id is None or driver_id in stored:
                continue
            end = window.start + timedelta(milliseconds=window.lap_ms)
            car = fetch_car_data(session_key, driver_number, window.start, end)
            location = fetch_location(session_key, driver_number, window.start, end)
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
                "samples": Json({_camel(k): v for k, v in asdict(telemetry).items()}),
            })
    except OpenF1BudgetExceeded:
        print(f"  OpenF1 request budget spent after {len(rows)} drivers — the rest resume next cycle")

    if not rows:
        return
    conn = get_conn()
    try:
        upsert(conn, "qualifying_lap_telemetry", rows, ["race_id", "session_type", "driver_id"])
        print(f"  Upserted {len(rows)} lap telemetry rows")
    finally:
        conn.close()
