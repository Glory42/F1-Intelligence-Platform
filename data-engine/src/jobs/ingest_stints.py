from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_session import stints
from src.utils.session_records import stint_rows

CONFIG = OpenF1JobConfig(
    job_name="ingest_stints", table="race_stints", part="stints", records=stints, to_rows=stint_rows, row_label="stints",
)


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(year, round_num, CONFIG, session_name=session_name)
