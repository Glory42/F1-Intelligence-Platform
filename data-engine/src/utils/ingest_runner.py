"""Three seams, not one: qualifying has no weather/laps/headshots, so forcing it through the
race/sprint config would just add always-None fields to an already-wide one; Race Event jobs
write OpenF1 rows almost as fetched, so their guard/shape split differs again."""

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Callable, Sequence

from psycopg2.extras import execute_batch

from src.db.client import get_conn
from src.enrichment_coverage import CONFLICT_KEYS
from src.session_kind import BY_CODE, BY_NAME, OPENF1_READY_AFTER_RACE_START, SPRINT, RaceSession
from src.utils.driver_registry import SeasonDrivers, register_session_drivers, season_drivers
from src.utils.jolpica_client import fetch_classification
from src.utils.openf1_session import (
    QUALIFYING_PARTS,
    RACE_PARTS,
    OpenF1Session,
    is_complete,
    lap_records,
    lap_times,
    load_session,
    qualifying_results,
    race_results,
    safety_car_laps,
    session_entries,
    session_weather_trace,
    weather_details,
    weather_label,
)
from src.utils.race_story import SessionStory, session_story
from src.utils.session_records import Rows, SessionNotReady
from src.utils.storage_guard import read_storage_tier
from src.utils.upsert import upsert


@dataclass(frozen=True)
class RaceContext:
    """circuit_id is set only by ingest_race, for the circuits.sc_probability recompute.
    race_date finds the weekend in OpenF1, whichever of its sessions is ingested."""

    race_id: int
    season_id: int
    race_date: date
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
    # circuits.sc_probability recompute): a visible, named step, not a buried one.
    cross_table_hook: Callable[[Any, RaceContext], None] | None = None


def cache_session_key(conn: Any, race_id: int, session: RaceSession, session_key: int) -> None:
    """Later jobs on the weekend read the key from the race row and skip the session lookup."""
    with conn.cursor() as cur:
        cur.execute(f"UPDATE races SET {session.key_column} = %s WHERE id = %s", (session_key, race_id))


def write_session_story(conn: Any, race_id: int, session: str, story: SessionStory, driver_map: dict[str, int]) -> None:
    """Race-story tables for one session, from either adapter's lap records; leaves the commit to the caller."""
    trace_rows = [
        {
            "race_id": race_id, "session_type": session, "driver_id": driver_map[code],
            "positions": t.positions, "gaps_ms": t.gaps_ms, "intervals_ms": t.intervals_ms, "laps_down": t.laps_down,
        }
        for code, t in story.traces.items() if code in driver_map
    ]
    battle_rows = [
        {
            "race_id": race_id, "session_type": session,
            "chaser_driver_id": driver_map[b.chaser], "leader_driver_id": driver_map[b.leader],
            "lap_start": b.lap_start, "lap_end": b.lap_end, "min_gap_ms": b.min_gap_ms,
        }
        for b in story.battles if b.chaser in driver_map and b.leader in driver_map
    ]
    if trace_rows:
        upsert(conn, "race_lap_traces", trace_rows, ["race_id", "session_type", "driver_id"], commit=False)
        upsert(conn, "race_battles", battle_rows, ["race_id", "session_type", "chaser_driver_id", "lap_start"],
               commit=False)
        print(f"  Upserted {len(trace_rows)} lap traces and {len(battle_rows)} battles")
    if story.weather:
        upsert(conn, "race_weather_traces", [{
            "race_id": race_id, "session_type": session,
            "minute_offsets": story.weather.minute_offsets,
            "air_temp_tenths": story.weather.air_temp_tenths,
            "track_temp_tenths": story.weather.track_temp_tenths,
            "rainfall": story.weather.rainfall,
        }], ["race_id", "session_type"], commit=False)


def run_ingest_job(year: int, round_num: int, config: IngestJobConfig) -> None:
    print(f"[{config.job_name}] year={year} round={round_num}")

    conn = get_conn()
    try:
        race_ctx = config.resolve_race(conn, year, round_num)
    finally:
        conn.close()

    # Fetched with no connection held: OpenF1's paced requests take a while and would keep Neon awake.
    session = load_session(year, race_ctx.race_date, config.session_type, RACE_PARTS)
    classification = fetch_classification(year, round_num, sprint=config.session_type == "S")
    if not is_complete(session, classification, config.session_type):
        raise SessionNotReady(f"{config.session_label} results not fully available or complete yet: retry later")
    entries = session_entries(session)
    weather = weather_label(session)
    weather_conditions = weather_details(session)
    sc_vsc = safety_car_laps(session)
    result_rows = race_results(session, classification)
    lap_time_rows = lap_times(session)
    story = session_story(lap_records(session), session_weather_trace(session))

    conn = get_conn()
    try:
        driver_map = register_session_drivers(conn, race_ctx.season_id, entries)

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
                    f"{config.session_label} result for unknown driver {rr['driver_code']}: not registered from the session"
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

        if read_storage_tier(conn).allows_optional:
            write_session_story(conn, race_ctx.race_id, BY_CODE[config.session_type].tag, story, driver_map)
        cache_session_key(conn, race_ctx.race_id, BY_CODE[config.session_type], session.session_key)

        config.mark_status(conn, race_ctx, weather, weather_conditions, sc_vsc)
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
    race_date: date


@dataclass(frozen=True)
class QualifyingJobConfig:
    job_name: str
    results_table: str
    results_row_label: str
    allowed_event_formats: frozenset[str]
    format_error: str  # .format(round_num=, event_format=)
    date_guard_error: str  # .format(year=, round_num=, day=)
    no_results_error: str  # .format(year=, round_num=, race_id=): superset kwargs; each job's
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
            raise SessionNotReady(config.date_guard_error.format(year=year, round_num=round_num, day=ctx.quali_day))

        if ctx.event_format not in config.allowed_event_formats:
            raise ValueError(
                config.format_error.format(round_num=round_num, event_format=ctx.event_format)
            )

        session_type = config.session_type_for(ctx.event_format)
        print(f"  event_format={ctx.event_format}: ingesting {session_type} session")

    finally:
        conn.close()

    # Fetched with no connection held: OpenF1's paced requests take a while and would keep Neon awake.
    session = load_session(year, ctx.race_date, session_type, QUALIFYING_PARTS)
    quali_rows = qualifying_results(session)
    entries = session_entries(session)

    conn = get_conn()
    try:
        driver_map = register_session_drivers(conn, ctx.season_id, entries)
        rows = config.rows_from_quali(quali_rows, driver_map, ctx.race_id)
        if not rows:
            raise SessionNotReady(config.no_results_error.format(year=year, round_num=round_num, race_id=ctx.race_id))

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


@dataclass(frozen=True)
class OpenF1JobConfig:
    """A Race Event or enrichment table filled from one part of the weekend's Race or Sprint session."""

    job_name: str
    table: str
    part: str
    records: Callable[[OpenF1Session], Sequence[Any]]
    to_rows: Callable[[Sequence[Any], SeasonDrivers, int, str], Rows]
    row_label: str


def run_openf1_job(year: int, round_num: int, config: OpenF1JobConfig, *, session_name: str = "Race") -> None:
    """session_name selects which session's data to pull: "Race" (the Sunday GP, default) or
    "Sprint" (the Saturday sprint race on a sprint weekend). Both are gated on the *weekend's*
    completion (status == 'completed') and OpenF1 live-window buffer off race_date_utc: by the
    time the GP is done and past the buffer, Saturday's sprint session is well outside its own
    live window too, so one gate covers both rather than needing a second timestamp column."""
    print(f"[{config.job_name}] year={year} round={round_num} session={session_name}")
    race_session = BY_NAME[session_name]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT r.id, r.season_id, r.race_date, r.race_date_utc, r.sprint_date, r.status, "
                "r.openf1_race_session_key, r.openf1_sprint_session_key FROM races r "
                "JOIN seasons s ON r.season_id = s.id "
                "WHERE s.year = %s AND r.round_number = %s",
                (year, round_num),
            )
            race_row = cur.fetchone()
        if not race_row:
            raise ValueError(f"Race not found for year={year} round={round_num}")

        race_id = race_row["id"]
        cached_session_key = race_row.get(race_session.key_column)
        if race_row["status"] != "completed":
            print(f"  [SKIP] Race {race_id} is not 'completed' yet (status={race_row['status']})")
            return

        race_date_utc = race_row["race_date_utc"]
        if race_date_utc is not None and datetime.now(timezone.utc) - race_date_utc < OPENF1_READY_AFTER_RACE_START:
            print(f"  [SKIP] Race {race_id} is still inside OpenF1's live-data window")
            return

        if race_session is SPRINT and race_row["sprint_date"] is None:
            print(f"  [SKIP] Race {race_id} has no sprint session")
            return

        tier = read_storage_tier(conn)
        if not tier.allows_optional:
            print(f"  [SKIP] Neon storage tier is {tier.value}: OpenF1 enrichment is not written")
            return
        drivers = season_drivers(conn, race_row["season_id"])
    finally:
        conn.close()

    # No connection held across OpenF1's paced HTTP calls: it would keep Neon compute awake.
    session = load_session(year, race_row["race_date"], race_session.code, (config.part,), session_key=cached_session_key)
    rows, skipped = config.to_rows(config.records(session), drivers, race_id, race_session.tag)
    skip_note = f" ({skipped} skipped: unknown driver number)" if skipped else ""

    conn = get_conn()
    try:
        if cached_session_key is None:
            cache_session_key(conn, race_id, race_session, session.session_key)
        if rows:
            upsert(conn, config.table, rows, CONFLICT_KEYS[config.table], commit=False)
            print(f"  Upserted {len(rows)} {config.row_label}{skip_note}")
        else:
            print(f"  No {config.row_label} upserted{skip_note}")

        conn.commit()
    finally:
        conn.close()
