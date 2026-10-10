from typing import Any

from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_client import fetch_pit_stops


def _to_ms(seconds: float | None) -> int | None:
    return None if seconds is None else round(seconds * 1000)


def _to_rows(
    stops: list[dict[str, Any]], race_id: int, driver_map: dict[int, int]
) -> tuple[list[dict[str, Any]], int]:
    rows = []
    skipped = 0
    for p in stops:
        driver_id = driver_map.get(p["driver_number"])
        if driver_id is None:
            skipped += 1
            continue
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "lap_number": p["lap_number"],
            "pit_lane_ms": _to_ms(p["pit_duration"]),
            "stationary_ms": _to_ms(p["stop_duration"]),
            "date": p["date"],
        })
    return rows, skipped


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(
        year, round_num,
        OpenF1JobConfig(
            job_name="ingest_pit_stops",
            table="race_pit_stops",
            conflict_cols=["race_id", "session_type", "driver_id", "lap_number"],
            row_label="pit stops",
            fetch=fetch_pit_stops,
            to_rows=_to_rows,
        ),
        session_name=session_name,
    )
