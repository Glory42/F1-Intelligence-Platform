from typing import Any

from src.enrichment_coverage import CONFLICT_KEYS
from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_client import fetch_overtakes


def _to_rows(
    overtakes: list[dict[str, Any]], race_id: int, driver_map: dict[int, int]
) -> tuple[list[dict[str, Any]], int]:
    rows = []
    skipped = 0
    for o in overtakes:
        overtaking_id = driver_map.get(o["overtaking_driver_number"])
        overtaken_id = driver_map.get(o["overtaken_driver_number"])
        if overtaking_id is None or overtaken_id is None:
            skipped += 1
            continue
        rows.append({
            "race_id": race_id,
            "date": o["date"],
            "overtaking_driver_id": overtaking_id,
            "overtaken_driver_id": overtaken_id,
            "position": o["position"],
        })
    return rows, skipped


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(
        year, round_num,
        OpenF1JobConfig(
            job_name="ingest_overtakes",
            table="race_overtakes",
            conflict_cols=CONFLICT_KEYS["race_overtakes"],
            row_label="overtakes",
            fetch=fetch_overtakes,
            to_rows=_to_rows,
        ),
        session_name=session_name,
    )
