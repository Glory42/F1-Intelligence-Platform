"""Three seams, not one: qualifying has no weather/laps/headshots, so forcing it through the
race/sprint config would just add always-None fields to an already-wide one; OpenF1 jobs pull
from a REST API instead of a FastF1 session object, so their guard/shape split differs again."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from psycopg2.extras import execute_batch

from src.db.client import get_conn
from src.utils.driver_map import build_driver_number_map
from src.utils.driver_registry import register_session_drivers, session_entries
from src.utils.fastf1_helpers import (
    get_sc_vsc_laps,
    get_session,
    get_weather,
    get_weather_details,
    session_to_lap_times,
    session_to_quali_results,
    session_to_race_results,
    validate_session_data,
)
from src.utils.openf1_client import get_session_key
from src.utils.upsert import upsert


@dataclass(frozen=True)
class RaceContext:
    """circuit_id is set only by ingest_race, for the circuits.sc_probability recompute."""

    race_id: int
    season_id: int
    circuit_id: int | None = None


@dataclass(frozen=True)
class IngestJobConfig:
    job_name: str
    session_type: str
    session_label: str
    results_table: str
    lap_times_table: str
    time_field: str
    results_row_label: str
    laps_row_label: str
    no_results_error: str
    resolve_race: Callable[[Any, int, int], RaceContext]
    mark_status: Callable[[Any, RaceContext, str, dict[str, float | None], dict[str, int]], None]
    # Runs after mark_status, for side effects on OTHER tables (e.g. ingest_race's
    # circuits.sc_probability recompute) — a visible, named step, not a buried one.
    cross_table_hook: Callable[[Any, RaceContext], None] | None = None


def run_ingest_job(year: int, round_num: int, config: IngestJobConfig) -> None:
    print(f"[{config.job_name}] year={year} round={round_num}")

    conn = get_conn()
    try:
        race_ctx = config.resolve_race(conn, year, round_num)

        session = get_session(year, round_num, config.session_type)

        if not validate_session_data(session, config.session_type):
            raise RuntimeError(
                f"{config.session_label} results not fully available or complete yet — retry later"
            )

        driver_map = register_session_drivers(conn, race_ctx.season_id, session_entries(session))

        weather = get_weather(session)
        weather_details = get_weather_details(session)
        sc_vsc = get_sc_vsc_laps(session)
        result_rows = session_to_race_results(session)
        lap_time_rows = session_to_lap_times(session)

        headshot_updates: dict[int, str] = {}
        for rr in result_rows:
            if rr.get("headshot_url"):
                driver_id = driver_map.get(rr["driver_code"])
                if driver_id:
                    headshot_updates[driver_id] = rr["headshot_url"]

        if headshot_updates:
            with conn.cursor() as cur:
                execute_batch(
                    cur,
                    "UPDATE drivers SET headshot_url = %s WHERE id = %s AND headshot_url IS NULL",
                    [(url, driver_id) for driver_id, url in headshot_updates.items()],
                )
            print(f"  Updated {len(headshot_updates)} driver headshot URLs")

        results_to_upsert: list[dict[str, Any]] = []
        for rr in result_rows:
            driver_id = driver_map.get(rr["driver_code"])
            if not driver_id:
                raise RuntimeError(
                    f"{config.session_label} result for unknown driver {rr['driver_code']} — not registered from the session"
                )
            results_to_upsert.append({
                "race_id": race_ctx.race_id,
                "driver_id": driver_id,
                "finish_position": rr["finish_position"],
                "grid_position": rr["grid_position"],
                "points": rr["points"],
                "status": rr["status"],
                config.time_field: rr["total_race_time_ms"],
                "fastest_lap": rr["fastest_lap"],
            })

        if not results_to_upsert:
            raise RuntimeError(config.no_results_error.format(race_id=race_ctx.race_id))

        upsert(conn, config.results_table, results_to_upsert, ["race_id", "driver_id"])
        print(f"  Upserted {len(results_to_upsert)} {config.results_row_label} rows")

        laps_to_upsert: list[dict[str, Any]] = []
        for lt in lap_time_rows:
            driver_id = driver_map.get(lt["driver_code"])
            if not driver_id:
                continue
            laps_to_upsert.append({
                "race_id": race_ctx.race_id,
                "driver_id": driver_id,
                "lap_number": lt["lap_number"],
                "lap_time_ms": lt["lap_time_ms"],
                "sector1_ms": lt["sector1_ms"],
                "sector2_ms": lt["sector2_ms"],
                "sector3_ms": lt["sector3_ms"],
                "speed_st": lt["speed_st"],
                "compound": lt["compound"],
                "tyre_life": lt["tyre_life"],
                "fresh_tyre": lt["fresh_tyre"],
                "is_pit_lap": lt["is_pit_lap"],
                "stint_number": lt["stint_number"],
            })

        if laps_to_upsert:
            upsert(
                conn,
                config.lap_times_table,
                laps_to_upsert,
                ["race_id", "driver_id", "lap_number"],
            )
            print(f"  Upserted {len(laps_to_upsert)} {config.laps_row_label} rows")

        config.mark_status(conn, race_ctx, weather, weather_details, sc_vsc)
        if config.cross_table_hook is not None:
            # Must run after mark_status: it reads races.status='completed', written above
            # in this same (uncommitted) transaction.
            config.cross_table_hook(conn, race_ctx)

        conn.commit()

    finally:
        conn.close()


@dataclass(frozen=True)
class QualifyingContext:
    race_id: int
    season_id: int
    event_format: str
    quali_day: date | None


@dataclass(frozen=True)
class QualifyingJobConfig:
    job_name: str
    results_table: str
    results_row_label: str
    allowed_event_formats: frozenset[str]
    format_error: str  # .format(round_num=, event_format=)
    date_guard_error: str  # .format(year=, round_num=, day=)
    no_results_error: str  # .format(year=, round_num=, race_id=) — superset kwargs; each job's
    # template only uses the ones it needs
    session_type_for: Callable[[str], str]
    resolve_race: Callable[[Any, int, int], QualifyingContext]
    rows_from_quali: Callable[[list[dict[str, Any]], dict[str, int], int], list[dict[str, Any]]]
    new_status: str
    status_guard: tuple[str, ...]
    exclude_update: list[str] | None = None


def run_qualifying_ingest_job(year: int, round_num: int, config: QualifyingJobConfig) -> None:
    print(f"[{config.job_name}] year={year} round={round_num}")

    conn = get_conn()
    try:
        ctx = config.resolve_race(conn, year, round_num)

        if ctx.quali_day is not None and ctx.quali_day > date.today():
            raise RuntimeError(
                config.date_guard_error.format(year=year, round_num=round_num, day=ctx.quali_day)
            )

        if ctx.event_format not in config.allowed_event_formats:
            raise ValueError(
                config.format_error.format(round_num=round_num, event_format=ctx.event_format)
            )

        session_type = config.session_type_for(ctx.event_format)
        print(f"  event_format={ctx.event_format} — ingesting {session_type} session")

        session = get_session(year, round_num, session_type, messages=True)
        driver_map = register_session_drivers(conn, ctx.season_id, session_entries(session))
        quali_rows = session_to_quali_results(session)

        rows = config.rows_from_quali(quali_rows, driver_map, ctx.race_id)
        if not rows:
            raise RuntimeError(
                config.no_results_error.format(year=year, round_num=round_num, race_id=ctx.race_id)
            )

        upsert(conn, config.results_table, rows, ["race_id", "driver_id"], exclude_update=config.exclude_update)
        print(f"  Upserted {len(rows)} {config.results_row_label} rows")

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE races SET status = %s WHERE id = %s AND status IN %s",
                (config.new_status, ctx.race_id, tuple(config.status_guard)),
            )
        conn.commit()
        print(f"  Race {ctx.race_id} status → {config.new_status}")

    finally:
        conn.close()


# OpenF1's free tier only serves data once a session is >30min past its end. We don't track
# exact race end time, so this buffers from the (known) start time by a typical race
# duration + margin — conservative in the direction of waiting longer, never running early
# enough to hit OpenF1's paid live window.
OPENF1_LIVE_WINDOW_BUFFER = timedelta(hours=3)


@dataclass(frozen=True)
class OpenF1JobConfig:
    job_name: str
    table: str
    conflict_cols: list[str]
    row_label: str
    fetch: Callable[[int], list[dict[str, Any]]]
    # (raw OpenF1 rows, race_id, driver_number->driver_id map) -> (rows to upsert, skipped count).
    # driver_map is always built and passed, even to configs that don't need it (e.g.
    # race_control) — one extra cheap query isn't worth a conditional in the runner.
    to_rows: Callable[[list[dict[str, Any]], int, dict[int, int]], tuple[list[dict[str, Any]], int]]


def run_openf1_job(year: int, round_num: int, config: OpenF1JobConfig, *, session_name: str = "Race") -> None:
    """session_name selects which session's data to pull: "Race" (the Sunday GP, default) or
    "Sprint" (the Saturday sprint race on a sprint weekend). Both are gated on the *weekend's*
    completion (status == 'completed') and OpenF1 live-window buffer off race_date_utc — by the
    time the GP is done and past the buffer, Saturday's sprint session is well outside its own
    live window too, so one gate covers both rather than needing a second timestamp column."""
    print(f"[{config.job_name}] year={year} round={round_num} session={session_name}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.race_date, r.race_date_utc, r.sprint_date, r.status FROM races r "
                "JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race_row = cur.fetchone()
        if not race_row:
            raise ValueError(f"Race not found for year={year} round={round_num}")

        race_id = race_row["id"]
        if race_row["status"] != "completed":
            print(f"  [SKIP] Race {race_id} is not 'completed' yet (status={race_row['status']})")
            return

        race_date_utc = race_row["race_date_utc"]
        if race_date_utc is not None and datetime.now(timezone.utc) - race_date_utc < OPENF1_LIVE_WINDOW_BUFFER:
            print(f"  [SKIP] Race {race_id} is still inside OpenF1's live-data window")
            return

        if session_name == "Sprint":
            session_date = race_row["sprint_date"]
            if session_date is None:
                print(f"  [SKIP] Race {race_id} has no sprint session")
                return
        else:
            session_date = race_row["race_date"]

        session_key = get_session_key(year, session_date, session_name=session_name)
        driver_map = build_driver_number_map(conn, race_row["season_id"])
        raw = config.fetch(session_key)
        rows, skipped = config.to_rows(raw, race_id, driver_map)
        skip_note = f" ({skipped} skipped — unknown driver number)" if skipped else ""

        if rows:
            upsert(conn, config.table, rows, config.conflict_cols)
            print(f"  Upserted {len(rows)} {config.row_label}{skip_note}")
        else:
            print(f"  No {config.row_label} upserted{skip_note}")

        conn.commit()
    finally:
        conn.close()
