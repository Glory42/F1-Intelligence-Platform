from typing import Any

from src.utils.ingest_runner import IngestJobConfig, RaceContext, run_ingest_job


def _resolve_race(conn: Any, year: int, round_num: int) -> RaceContext:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.id, r.season_id, r.circuit_id, r.race_date FROM races r "
            "JOIN seasons s ON r.season_id = s.id "
            "WHERE s.year = %s AND r.round_number = %s",
            (year, round_num),
        )
        race_row = cur.fetchone()
    if not race_row:
        raise ValueError(f"Race not found for year={year} round={round_num}")

    return RaceContext(
        race_id=race_row["id"],
        season_id=race_row["season_id"],
        race_date=race_row["race_date"],
        circuit_id=race_row["circuit_id"],
    )


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
            """UPDATE races
               SET status = 'completed',
                   weather = %s,
                   safety_car_laps = %s,
                   vsc_laps = %s,
                   air_temp_avg = %s,
                   track_temp_avg = %s,
                   humidity_avg = %s
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
        f"  Race {race_id} → completed | weather={weather} "
        f"SC={sc_vsc['safety_car_laps']} VSC={sc_vsc['vsc_laps']} "
        f"AirTemp={weather_details['air_temp_avg']}°C"
    )


def _recompute_circuit_sc_probability(conn: Any, race_ctx: RaceContext) -> None:
    """Refresh circuits.sc_probability for this race's circuit from all completed races:
    a cross-table side effect of a race finishing, distinct from this race's own status write."""
    circuit_id = race_ctx.circuit_id

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE circuits
            SET sc_probability = (
                SELECT ROUND(
                    COUNT(*) FILTER (WHERE r2.safety_car_laps > 0)::numeric /
                    NULLIF(COUNT(*) FILTER (WHERE r2.status = 'completed'), 0),
                    3
                )
                FROM races r2
                WHERE r2.circuit_id = circuits.id AND r2.status = 'completed'
            )
            WHERE circuits.id = %s
            """,
            (circuit_id,),
        )
    print(f"  Recomputed sc_probability for circuit {circuit_id}")


def run(year: int, round_num: int) -> None:
    run_ingest_job(
        year,
        round_num,
        IngestJobConfig(
            job_name="ingest_race",
            session_type="R",
            session_label="Race",
            results_table="race_results",
            lap_times_table="lap_times",
            time_field="total_race_time_ms",
            results_row_label="race result",
            laps_row_label="lap time",
            no_results_error="No results inserted for race {race_id}: all driver codes unknown",
            resolve_race=_resolve_race,
            mark_status=_mark_status,
            cross_table_hook=_recompute_circuit_sc_probability,
        ),
    )
