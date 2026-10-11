from typing import Any

from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_client import fetch_team_radio


def _to_rows(
    clips: list[dict[str, Any]], race_id: int, driver_map: dict[int, int]
) -> tuple[list[dict[str, Any]], int]:
    rows = []
    skipped = 0
    for c in clips:
        driver_id = driver_map.get(c["driver_number"])
        if driver_id is None:
            skipped += 1
            continue
        rows.append({
            "race_id": race_id,
            "driver_id": driver_id,
            "date": c["date"],
            "recording_url": c["recording_url"],
        })
    return rows, skipped


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    # F1 doesn't release radio for every session, so an empty or partial result here is
    # a normal outcome, not an error: run_openf1_job's skip-count logging covers this.
    run_openf1_job(
        year, round_num,
        OpenF1JobConfig(
            job_name="ingest_team_radio",
            table="team_radio_clips",
            conflict_cols=["race_id", "driver_id", "date"],
            row_label="team radio clips",
            fetch=fetch_team_radio,
            to_rows=_to_rows,
        ),
        session_name=session_name,
    )
