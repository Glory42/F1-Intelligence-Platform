from src.utils.ingest_runner import OpenF1JobConfig, run_openf1_job
from src.utils.openf1_session import radio_clips
from src.utils.session_records import radio_rows

# F1 doesn't release radio for every session, so an empty or partial result is a normal outcome.
CONFIG = OpenF1JobConfig(
    job_name="ingest_team_radio", table="team_radio_clips", part="team_radio", records=radio_clips,
    to_rows=radio_rows, row_label="team radio clips",
)


def run(year: int, round_num: int, session_name: str = "Race") -> None:
    run_openf1_job(year, round_num, CONFIG, session_name=session_name)
