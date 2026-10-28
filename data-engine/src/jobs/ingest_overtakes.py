from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_session import overtakes
from src.utils.session_records import overtake_rows

CONFIG = OpenF1JobConfig(
    job_name="ingest_overtakes", table="race_overtakes", part="overtakes", records=overtakes, to_rows=overtake_rows, row_label="overtakes",
)


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(year, round_num, CONFIG, session_name=session_name)
