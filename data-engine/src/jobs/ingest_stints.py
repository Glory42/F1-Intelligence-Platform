from typing import Any

from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_client import fetch_stints


def _to_rows(
    stints: list[dict[str, Any]], race_id: int, driver_map: dict[int, int]
) -> tuple[list[dict[str, Any]], int]:
    rows = []
    skipped = 0
    for s in stints:
        driver_id = driver_map.get(s["driver_number"])
        if driver_id is None:
            skipped += 1
            continue
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "stint_number": s["stint_number"],
            "compound": s["compound"],
            "lap_start": s["lap_start"],
            "lap_end": s["lap_end"],
            "tyre_age_at_start": s["tyre_age_at_start"],
        })
    return rows, skipped


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(
        year, round_num,
        OpenF1JobConfig(
            job_name="ingest_stints",
            table="race_stints",
            conflict_cols=["race_id", "session_type", "driver_id", "stint_number"],
            row_label="stints",
            fetch=fetch_stints,
            to_rows=_to_rows,
        ),
        session_name=session_name,
    )
