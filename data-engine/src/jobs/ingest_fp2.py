import requests

from src.db.client import get_conn
from src.session_kind import is_sprint_weekend
from src.utils.driver_registry import SeasonDrivers, season_drivers
from src.utils.openf1_client import OpenF1BudgetExceeded
from src.utils.openf1_session import PRACTICE_PARTS, PracticeLap, load_session, practice_laps
from src.utils.session_records import SessionNotReady
from src.utils.upsert import upsert

# Normalise all compounds to a MEDIUM baseline (ms to add to raw lap time)
# Soft is ~0.5s faster than Medium, Hard is ~0.4s slower
COMPOUND_OFFSET_MS = {
    "SOFT":   500,
    "MEDIUM": 0,
    "HARD":   -400,
}

def select_practice_session(event_format: str | None) -> str:
    """Sprint weekends have no FP2 session, so they fall back to FP1 for long-run pace."""
    return "FP1" if is_sprint_weekend(event_format) else "FP2"


def _median(values: list[int]) -> int:
    values = sorted(values)
    mid = len(values) // 2
    return values[mid] if len(values) % 2 == 1 else (values[mid - 1] + values[mid]) // 2


def long_run_rows(laps: list[PracticeLap], drivers: SeasonDrivers, race_id: int, session_type: str) -> list[dict]:
    """Per driver and compound, the best median of a run's laps 3 to N-1 (warm-up and final
    outlap skipped), each lap shifted to a MEDIUM baseline."""
    laps_by_run: dict[tuple[int, int], list[tuple[int, int, str]]] = {}
    session_best: dict[int, int] = {}
    runs: dict[int, int] = {}
    for lap in sorted(laps, key=lambda l: (l.driver_number, l.lap_number)):
        number = lap.driver_number
        # A run ends at every pit visit, tyres changed or not, as FastF1 numbered its stints.
        runs[number] = runs.get(number, 0) + (1 if lap.is_pit_out_lap or number not in runs else 0)
        # OpenF1 times the out-lap from the garage; FastF1 left it untimed, so it never counted.
        if lap.is_pit_out_lap or lap.lap_ms is None or lap.compound not in COMPOUND_OFFSET_MS:
            continue
        session_best[number] = min(lap.lap_ms, session_best.get(number, lap.lap_ms))
        laps_by_run.setdefault((number, runs[number]), []).append((lap.lap_number, lap.lap_ms, lap.compound))

    best: dict[tuple[int, str], dict] = {}
    for (number, _), stint_laps in laps_by_run.items():
        driver_id = drivers.id_for(number)
        if not driver_id or len(stint_laps) < 5:
            continue
        trimmed = sorted(stint_laps)[2:-1]
        if len(trimmed) < 3:
            continue
        compound = trimmed[0][2]
        median_ms = _median([lap_ms + COMPOUND_OFFSET_MS[compound] for _, lap_ms, _ in trimmed])
        existing = best.get((driver_id, compound))
        if existing is None or median_ms < existing["median_lap_ms"]:
            best[(driver_id, compound)] = {
                "race_id": race_id,
                "driver_id": driver_id,
                "compound": compound,
                "session_type": session_type,
                "median_lap_ms": median_ms,
                "stint_length": len(trimmed),
                "fp2_best_lap_ms": session_best.get(number),
            }
    return list(best.values())


def run(year: int, round_num: int) -> bool:
    """False while OpenF1 hasn't published the practice session: the worker's coverage retry tries again."""
    print(f"[ingest_fp2] year={year} round={round_num}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.event_format, r.race_date FROM races r "
                "JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race_row = cur.fetchone()
        if not race_row:
            raise ValueError(f"Race not found for year={year} round={round_num}")

        race_id = race_row["id"]
        drivers = season_drivers(conn, race_row["season_id"])
    finally:
        conn.close()

    # Fetched with no connection held: OpenF1's paced requests take a while and would keep Neon awake.
    session_type = select_practice_session(race_row.get("event_format"))
    try:
        session = load_session(year, race_row["race_date"], session_type, PRACTICE_PARTS)
    except (SessionNotReady, OpenF1BudgetExceeded, requests.RequestException) as e:
        print(f"  [SKIP] {session_type} practice session could not be loaded: {e}")
        return False
    if not session.laps:
        print(f"  [SKIP] {session_type} laps not available for {year} round {round_num}")
        return False

    final_rows = long_run_rows(practice_laps(session), drivers, race_id, session_type)

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
    return True
