from typing import Any

from src.db.client import get_conn
from src.utils.driver_map import build_driver_number_map
from src.utils.openf1_session import PRACTICE_PARTS, OpenF1Session, load_session, stint_for, stints_by_driver
from src.utils.upsert import upsert

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


def _load_practice_session(year: int, race_date: Any, event_format: str) -> tuple[OpenF1Session, str]:
    """Returns (session, session_type) with session_type 'FP2' or 'FP1' per select_practice_session."""
    session_type = select_practice_session(event_format)
    return load_session(year, race_date, session_type, PRACTICE_PARTS), session_type


def _median(values: list[int]) -> int:
    values = sorted(values)
    mid = len(values) // 2
    return values[mid] if len(values) % 2 == 1 else (values[mid - 1] + values[mid]) // 2


def long_run_rows(session: OpenF1Session, driver_map: dict[int, int], race_id: int, session_type: str) -> list[dict]:
    """Per driver and compound, the best median of a run's laps 3 to N-1 (warm-up and final
    outlap skipped), each lap shifted to a MEDIUM baseline. driver_map: car number -> driver_id."""
    stints = stints_by_driver(session.stints)
    laps_by_run: dict[tuple[int, int], list[tuple[int, int, str]]] = {}
    session_best: dict[int, int] = {}
    runs: dict[int, int] = {}
    for lap in sorted(session.laps, key=lambda l: (l["driver_number"], l["lap_number"])):
        number = lap["driver_number"]
        # A run ends at every pit visit, tyres changed or not, as FastF1 numbered its stints.
        runs[number] = runs.get(number, 0) + (1 if lap.get("is_pit_out_lap") or number not in runs else 0)
        duration = lap.get("lap_duration")
        stint = stint_for(stints.get(number, []), lap["lap_number"])
        compound = (stint.get("compound") or "").upper() if stint else ""
        # OpenF1 times the out-lap from the garage; FastF1 left it untimed, so it never counted.
        if lap.get("is_pit_out_lap") or not duration or duration <= 0 or compound not in COMPOUND_OFFSET_MS:
            continue
        lap_ms = round(duration * 1000)
        session_best[number] = min(lap_ms, session_best.get(number, lap_ms))
        laps_by_run.setdefault((number, runs[number]), []).append((lap["lap_number"], lap_ms, compound))

    best: dict[tuple[int, str], dict] = {}
    for (number, _), stint_laps in laps_by_run.items():
        driver_id = driver_map.get(number)
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


def run(year: int, round_num: int) -> None:
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
        driver_map = build_driver_number_map(conn, race_row["season_id"])
    finally:
        conn.close()

    # Fetched with no connection held: OpenF1's paced requests take a while and would keep Neon awake.
    event_format = race_row.get("event_format") or "conventional"
    session_type = select_practice_session(event_format)
    try:
        session, session_type = _load_practice_session(year, race_row["race_date"], event_format)
    except Exception as e:
        print(f"  [SKIP] {session_type} practice session could not be loaded: {e}")
        return
    if not session.laps:
        print(f"  [SKIP] {session_type} laps not available for {year} round {round_num}")
        return

    final_rows = long_run_rows(session, driver_map, race_id, session_type)

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
