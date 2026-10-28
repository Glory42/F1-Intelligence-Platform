from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_session import pit_stops
from src.utils.session_records import pit_stop_rows

CONFIG = OpenF1JobConfig(
    job_name="ingest_pit_stops", table="race_pit_stops", part="pits", records=pit_stops, to_rows=pit_stop_rows, row_label="pit stops",
)


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(year, round_num, CONFIG, session_name=session_name)
