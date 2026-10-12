from typing import Any

from src.enrichment_coverage import CONFLICT_KEYS
from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_client import fetch_race_control


def _to_rows(
    messages: list[dict[str, Any]], race_id: int, driver_map: dict[int, int]
) -> tuple[list[dict[str, Any]], int]:
    rows = [
        {
            "race_id": race_id,
            "date": m["date"],
            "category": m["category"],
            "flag": m.get("flag"),
            "lap_number": m.get("lap_number"),
            "driver_number": m.get("driver_number"),
            "scope": m.get("scope"),
            "sector": m.get("sector"),
            "message": m["message"],
        }
        for m in messages
    ]
    return rows, 0


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(
        year, round_num,
        OpenF1JobConfig(
            job_name="ingest_race_control",
            table="race_control_messages",
            conflict_cols=CONFLICT_KEYS["race_control_messages"],
            row_label="race control messages",
            fetch=fetch_race_control,
            to_rows=_to_rows,
        ),
        session_name=session_name,
    )
