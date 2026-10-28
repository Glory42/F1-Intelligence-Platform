from typing import Any

from src.session_kind import SPRINT_FORMATS
from src.utils.ingest_runner import IngestJobConfig, RaceContext, run_ingest_job


def _resolve_race(conn: Any, year: int, round_num: int) -> RaceContext:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.event_format, r.race_date FROM races r "
            "JOIN seasons s ON r.season_id = s.id "
            "WHERE s.year = %s AND r.round_number = %s",
            (year, round_num),
        )
        race_row = cur.fetchone()
    if not race_row:
        raise ValueError(f"Race not found for year={year} round={round_num}")

    event_format = race_row["event_format"] or ""
    if event_format not in SPRINT_FORMATS:
        raise ValueError(
            f"Round {round_num} has event_format='{event_format}': not a sprint weekend. "
            "Cannot run ingest_sprint."
        )
    print(f"  event_format={event_format}: ingesting Session3 (sprint race)")

    return RaceContext(race_id=race_row["id"], season_id=race_row["season_id"], race_date=race_row["race_date"])


def _mark_status(
    conn: Any,
    race_ctx: RaceContext,
    weather: str,
    weather_details: dict[str, float | None],
    sc_vsc: dict[str, int],
) -> None:
    race_id = race_ctx.race_id

    with conn.cursor() as cur:
        cur.execute(
            """UPDATE races SET
                sprint_weather = %s,
                sprint_safety_car_laps = %s,
                sprint_vsc_laps = %s,
                sprint_air_temp_avg = %s,
                sprint_track_temp_avg = %s,
                sprint_humidity_avg = %s
            WHERE id = %s""",
            (
                weather,
                sc_vsc["safety_car_laps"],
                sc_vsc["vsc_laps"],
                weather_details["air_temp_avg"],
                weather_details["track_temp_avg"],
                weather_details["humidity_avg"],
                race_id,
            ),
        )
    print(
        f"  Updated sprint conditions: weather={weather}, "
        f"SC={sc_vsc['safety_car_laps']}, VSC={sc_vsc['vsc_laps']}"
    )

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE races SET status = 'sprint_done' WHERE id = %s "
            "AND status IN ('scheduled', 'sprint_qualifying_done')",
            (race_id,),
        )
    print(f"  Race {race_id} status → sprint_done")


def run(year: int, round_num: int) -> None:
    run_ingest_job(
        year,
        round_num,
        IngestJobConfig(
            job_name="ingest_sprint",
            session_type="S",
            session_label="Sprint",
            results_table="sprint_results",
            lap_times_table="sprint_lap_times",
            time_field="total_sprint_time_ms",
            results_row_label="sprint result",
            laps_row_label="sprint lap",
            no_results_error="No sprint results for race {race_id}: all driver codes unknown",
            resolve_race=_resolve_race,
            mark_status=_mark_status,
        ),
    )
