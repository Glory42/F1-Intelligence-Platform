import fastf1
import pandas as pd
from src.db.client import get_conn
from src.utils.upsert import upsert

# FastF1 uses Location (city-level) — map to our circuit_key
LOCATION_TO_CIRCUIT_KEY: dict[str, str] = {
    # Current calendar
    "Sakhir": "bahrain",
    "Bahrain": "bahrain",
    "Jeddah": "jeddah",
    "Melbourne": "albert_park",
    "Suzuka": "suzuka",
    "Shanghai": "shanghai",
    "Miami": "miami",
    "Miami Gardens": "miami",          # FastF1 2025 uses this name
    "Imola": "imola",
    "Monte Carlo": "monaco",
    "Monaco": "monaco",                # FastF1 sometimes uses this
    "Montréal": "canada",
    "Montreal": "canada",              # ASCII fallback
    "Barcelona": "catalunya",
    "Spielberg": "red_bull_ring",      # FastF1 uses "Spielberg" for both A1-Ring and Red Bull Ring;
                                       # maps to red_bull_ring (2014+); a1_ring (pre-2004) needs year context
    "Silverstone": "silverstone",
    "Budapest": "hungaroring",
    "Spa-Francorchamps": "spa",
    "Spa": "spa",
    "Zandvoort": "zandvoort",
    "Monza": "monza",
    "Baku": "baku",
    "Marina Bay": "singapore",
    "Singapore": "singapore",
    "Austin": "austin",
    "Mexico City": "mexico_city",
    "São Paulo": "interlagos",
    "Sao Paulo": "interlagos",         # ASCII fallback
    "Interlagos": "interlagos",
    "Las Vegas": "las_vegas",
    "Lusail": "lusail",
    "Yas Island": "yas_marina",
    "Yas Marina": "yas_marina",
    "Abu Dhabi": "yas_marina",
    "Madrid": "madrid",
    # 2018-2020 historical
    "Portimão": "portimao",
    "Sochi": "sochi",
    "Istanbul": "istanbul",
    "Le Castellet": "paul_ricard",
    "Hockenheim": "hockenheim",
    "Nürburg": "nurburgring",
    "Nürburgring": "nurburgring",
    "Mugello": "mugello",
    # 2000-2017 historical
    "Magny Cours": "magny_cours",       # FastF1 omits hyphen
    "Magny-Cours": "magny_cours",
    "Oyama": "fuji_speedway",           # Japanese GP at Fuji 2007-2008
    "Yeongam County": "korea",
    "Yeongam": "korea",
    "Uttar Pradesh": "india",
    "Greater Noida": "india",
    "New Delhi": "india",
    "Kuala Lumpur": "sepang",
    "Sepang": "sepang",
    "Indianapolis": "indianapolis",
    "Valencia": "valencia",
    # 1990-1999 historical
    "Phoenix": "phoenix",
    "Estoril": "estoril",
    "Jerez de la Frontera": "jerez",
    "Adelaide": "adelaide",
    "Midrand": "kyalami",
    "Castle Donington": "donington",
    "Buenos Aires": "buenos_aires",
    # 1980s historical
    "California": "long_beach",
    "Heusden-Zolder": "zolder",
    "Kent": "brands_hatch",
    "Nevada": "caesars_palace",
    "New York State": "watkins_glen",
    "Rio de Janeiro": "jacarepagua",
    "Dallas": "dallas",
    "Detroit": "detroit",
    "Dijon": "dijon",
}


SPRINT_FORMATS = {"sprint", "sprint_qualifying", "sprint_shootout"}


def _to_utc_iso(ts) -> str | None:
    """Convert a FastF1 session timestamp to an ISO-8601 UTC string, or None."""
    import pandas as pd
    if ts is None or (hasattr(pd, "isna") and pd.isna(ts)):
        return None
    try:
        return ts.isoformat()
    except Exception:
        return None


def plan_round_moves(existing: list[dict], incoming: list[dict]) -> dict[int, int]:
    """Race id -> new round for every stored race FastF1 has renumbered, matched by event name,
    so a race keeps its row (and its results) when another event is added or dropped before it."""
    new_round = {r["name"]: r["round_number"] for r in incoming}
    return {
        race["id"]: new_round[race["name"]]
        for race in existing
        if race["name"] in new_round and new_round[race["name"]] != race["round_number"]
    }


def _apply_round_moves(conn, moves: dict[int, int]) -> None:
    if not moves:
        return
    with conn.cursor() as cur:
        # Park the moving rows on negative rounds first so (season, round) stays unique mid-update.
        cur.execute("UPDATE races SET round_number = -round_number WHERE id = ANY(%s)", (list(moves),))
        for race_id, round_number in moves.items():
            cur.execute("UPDATE races SET round_number = %s WHERE id = %s", (round_number, race_id))


def run(year: int, schedule: pd.DataFrame | None = None) -> None:
    print(f"[sync_schedule] year={year}")

    if schedule is None:
        # Bypass FastF1's 12h HTTP cache: a stale calendar is exactly what this job exists to fix.
        with fastf1.Cache.disabled():
            schedule = fastf1.get_event_schedule(year, include_testing=False)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM seasons WHERE year = %s", (year,))
            row = cur.fetchone()
        if not row:
            raise ValueError(f"Season {year} not found — run db:seed first")
        season_id = row["id"]

        with conn.cursor() as cur:
            cur.execute("SELECT id, circuit_key FROM circuits")
            circuit_map: dict[str, int] = {r["circuit_key"]: r["id"] for r in cur.fetchall()}

        with conn.cursor() as cur:
            cur.execute("SELECT id, round_number, name FROM races WHERE season_id = %s", (season_id,))
            existing_races = cur.fetchall()

        rows_to_upsert = []
        for _, event in schedule.iterrows():
            location = str(event.get("Location", ""))
            circuit_key = LOCATION_TO_CIRCUIT_KEY.get(location)

            if location == "Madrid" and year < 2026:
                circuit_key = "jarama"
            elif location == "Spielberg" and year < 2014:
                circuit_key = "a1_ring"

            if not circuit_key:
                print(f"  [warn] No circuit_key mapping for Location='{location}' (Round {event['RoundNumber']})")
                continue

            circuit_id = circuit_map.get(circuit_key)
            if not circuit_id:
                print(f"  [warn] circuit_key '{circuit_key}' not in DB — run db:seed first")
                continue

            event_date = event["EventDate"]
            race_date = event_date.date().isoformat() if isinstance(event_date, pd.Timestamp) else str(event_date)[:10]

            event_format = str(event.get("EventFormat", "conventional")).lower()
            is_sprint = event_format in SPRINT_FORMATS

            # Session4/5 = Qualifying/Race always; Session2/3 = Sprint Quali/Race (sprint only).
            qualifying_date = _to_utc_iso(event.get("Session4DateUtc"))
            sprint_date = _to_utc_iso(event.get("Session3DateUtc")) if is_sprint else None
            sprint_qualifying_date = _to_utc_iso(event.get("Session2DateUtc")) if is_sprint else None
            race_date_utc = _to_utc_iso(event.get("Session5DateUtc"))

            print(
                f"  Round {int(event['RoundNumber'])}: {event['EventName']} | "
                f"format={event_format} | quali={qualifying_date} | sprint={sprint_date} | race_utc={race_date_utc}"
            )

            rows_to_upsert.append({
                "season_id": season_id,
                "circuit_id": circuit_id,
                "round_number": int(event["RoundNumber"]),
                "name": str(event["EventName"]),
                "race_date": race_date,
                "race_date_utc": race_date_utc,
                "event_format": event_format,
                "qualifying_date": qualifying_date,
                "sprint_date": sprint_date,
                "sprint_qualifying_date": sprint_qualifying_date,
                "status": "scheduled",
            })

        if rows_to_upsert:
            moves = plan_round_moves(existing_races, rows_to_upsert)
            for race_id, round_number in moves.items():
                print(f"  Race {race_id} moves to round {round_number}")
            _apply_round_moves(conn, moves)
            # Exclude 'status' from UPDATE so re-running never resets completed races back to scheduled
            upsert(conn, "races", rows_to_upsert, ["season_id", "round_number"], exclude_update=["status"])
            sprint_count = sum(1 for r in rows_to_upsert if r["sprint_date"])
            print(f"  Synced {len(rows_to_upsert)} races ({sprint_count} sprint weekends) for {year}")
        else:
            print("  No races synced — check LOCATION_TO_CIRCUIT_KEY mapping")

    finally:
        conn.close()
