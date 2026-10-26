from typing import Any

from src.utils.ingest_runner import QualifyingContext, QualifyingJobConfig, run_qualifying_ingest_job

SPRINT_FORMATS = frozenset({"sprint", "sprint_qualifying", "sprint_shootout"})


def _resolve_race(conn: Any, year: int, round_num: int) -> QualifyingContext:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.event_format, r.race_date, r.sprint_qualifying_date::date AS sq_day "
            "FROM races r JOIN seasons s ON r.season_id = s.id "
            "WHERE s.year = %s AND r.round_number = %s",
            (year, round_num),
        )
        race_row = cur.fetchone()
    if not race_row:
        raise ValueError(f"Race not found for year={year} round={round_num}")

    return QualifyingContext(
        race_id=race_row["id"],
        season_id=race_row["season_id"],
        event_format=race_row["event_format"] or "",
        quali_day=race_row["sq_day"],
        race_date=race_row["race_date"],
    )


def _session_type_for(event_format: str) -> str:
    # 2023 renamed "Sprint Qualifying" → "Sprint Shootout" (identifier: "SS")
    return "SS" if event_format == "sprint_shootout" else "SQ"


def _rows_from_quali(
    quali_rows: list[dict[str, Any]], driver_map: dict[str, int], race_id: int
) -> list[dict[str, Any]]:
    """Writes grid/SQ times into sprint_results; ingest_sprint later fills in finish results."""
    rows = []
    for row in quali_rows:
        code = row["driver_code"]
        driver_id = driver_map.get(code)
        if not driver_id:
            print(f"  [warn] Unknown driver: {code}")
            continue
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "grid_position": row["grid_position"],
            "finish_position": None,
            "points": 0,
            "status": "grid_set",
            "total_sprint_time_ms": None,
            "fastest_lap": False,
            "sq1_time_ms": row["q1_time_ms"],
            "sq2_time_ms": row["q2_time_ms"],
            "sq3_time_ms": row["q3_time_ms"],
            "sq_sector1_ms": row["sector1_ms"],
            "sq_sector2_ms": row["sector2_ms"],
            "sq_sector3_ms": row["sector3_ms"],
            "sq_speed_st": row["speed_st"],
        })
    return rows


def run(year: int, round_num: int) -> None:
    run_qualifying_ingest_job(
        year,
        round_num,
        QualifyingJobConfig(
            job_name="ingest_sprint_qualifying",
            results_table="sprint_results",
            results_row_label="sprint grid (SQ)",
            allowed_event_formats=SPRINT_FORMATS,
            format_error=(
                "Round {round_num} has event_format='{event_format}': not a sprint weekend. "
                "Cannot run ingest_sprint_qualifying."
            ),
            date_guard_error="Sprint qualifying for {year} R{round_num} is on {day}: not yet. Skipping.",
            no_results_error="No SQ results for race {race_id}: all driver codes unknown",
            session_type_for=_session_type_for,
            resolve_race=_resolve_race,
            rows_from_quali=_rows_from_quali,
            new_status="sprint_qualifying_done",
            status_guard=("scheduled",),
            # Never overwrite sprint race finish data: only update grid/SQ columns.
            exclude_update=["finish_position", "points", "status", "total_sprint_time_ms", "fastest_lap"],
        ),
    )
