from typing import Any

from src.utils.ingest_runner import QualifyingContext, QualifyingJobConfig, run_qualifying_ingest_job

SUPPORTED_FORMATS = frozenset({"conventional", "sprint_qualifying", "sprint", "sprint_shootout"})


def _resolve_race(conn: Any, year: int, round_num: int) -> QualifyingContext:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.event_format, r.race_date, "
            "       COALESCE(r.qualifying_date::date, r.race_date::date - 1) AS quali_day "
            "FROM races r JOIN seasons s ON r.season_id = s.id "
            "WHERE s.year = %s AND r.round_number = %s",
            (year, round_num),
        )
        race_row = cur.fetchone()
    if not race_row:
        raise ValueError(f"Race not found in DB for year={year} round={round_num}")

    return QualifyingContext(
        race_id=race_row["id"],
        season_id=race_row["season_id"],
        event_format=race_row["event_format"] or "conventional",
        quali_day=race_row["quali_day"],
        race_date=race_row["race_date"],
    )


def _session_type_for(event_format: str) -> str:
    return "Q"


def _rows_from_quali(
    quali_rows: list[dict[str, Any]], driver_map: dict[str, int], race_id: int
) -> list[dict[str, Any]]:
    rows = []
    for qr in quali_rows:
        code = qr["driver_code"]
        driver_id = driver_map.get(code)
        if not driver_id:
            print(f"  [warn] Unknown driver code: {code}")
            continue
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "grid_position": qr["grid_position"],
            "q1_time_ms": qr["q1_time_ms"],
            "q2_time_ms": qr["q2_time_ms"],
            "q3_time_ms": qr["q3_time_ms"],
            "sector1_ms": qr.get("sector1_ms"),
            "sector2_ms": qr.get("sector2_ms"),
            "sector3_ms": qr.get("sector3_ms"),
            "speed_st": qr.get("speed_st"),
        })
    return rows


def run(year: int, round_num: int) -> None:
    run_qualifying_ingest_job(
        year,
        round_num,
        QualifyingJobConfig(
            job_name="ingest_qualifying",
            results_table="qualifying_results",
            results_row_label="qualifying",
            allowed_event_formats=SUPPORTED_FORMATS,
            format_error=(
                "Cannot run ingest_qualifying for event_format='{event_format}' "
                "(round {round_num}). Only standard qualifying formats are supported."
            ),
            date_guard_error="Qualifying for {year} R{round_num} is on {day}: not yet. Skipping.",
            no_results_error="No qualifying results found for {year} R{round_num}: session may not have data yet",
            session_type_for=_session_type_for,
            resolve_race=_resolve_race,
            rows_from_quali=_rows_from_quali,
            new_status="qualifying_done",
            status_guard=("scheduled", "sprint_done"),
        ),
    )
