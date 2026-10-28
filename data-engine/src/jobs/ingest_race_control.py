from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_session import race_control_messages
from src.utils.session_records import race_control_rows

CONFIG = OpenF1JobConfig(
    job_name="ingest_race_control", table="race_control_messages", part="race_control", records=race_control_messages, to_rows=race_control_rows, row_label="race control messages",
)


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(year, round_num, CONFIG, session_name=session_name)
