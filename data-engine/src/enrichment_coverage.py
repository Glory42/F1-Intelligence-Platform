"""One definition per enrichment (table, session): the step that fills it, which source serves a
season, how a weekend is known to be missing it, and how its rows are keyed and shaped."""
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

from src.utils.storage_guard import read_storage_tier


class Source(Enum):
    FASTF1 = "fastf1"
    OPENF1 = "openf1"


FASTF1_FIRST_YEAR = 2018
OPENF1_FIRST_YEAR = 2023


def source_for(year: int) -> Optional[Source]:
    """OpenF1 has no data before 2023; FastF1's lap timing (stints, pits, telemetry) starts 2018."""
    if year >= OPENF1_FIRST_YEAR:
        return Source.OPENF1
    if year >= FASTF1_FIRST_YEAR:
        return Source.FASTF1
    return None


# Natural key of each enrichment table: whichever source fills a row, it upserts on these.
CONFLICT_KEYS: dict[str, list[str]] = {
    "race_control_messages": ["race_id", "date", "message"],
    "race_overtakes": ["race_id", "date", "overtaking_driver_id", "overtaken_driver_id"],
    "team_radio_clips": ["race_id", "driver_id", "date"],
    "race_stints": ["race_id", "session_type", "driver_id", "stint_number"],
    "race_pit_stops": ["race_id", "session_type", "driver_id", "lap_number"],
    "qualifying_lap_telemetry": ["race_id", "session_type", "driver_id"],
}

# Both sources write a missing compound as text ('nan', 'UNKNOWN', ...) rather than a null.
_NO_COMPOUND = {"", "NAN", "NONE", "<NA>", "UNKNOWN", "TEST_UNKNOWN"}


def normalize_compound(value: Any) -> Optional[str]:
    """One spelling per tyre compound whichever source a stint came from; None when unknown."""
    text = "" if value is None else str(value).strip().upper()
    return None if text in _NO_COMPOUND else text


# races.session_type tag -> the session name OpenF1 jobs and the CLI take.
SESSIONS = {"race": "Race", "sprint": "Sprint"}


def step_name(job: str, session_type: str) -> str:
    """The pipeline step that runs `job` for one session: `ingest_stints`, `ingest_stints_sprint`."""
    return job if session_type == "race" else f"{job}_{session_type}"


@dataclass(frozen=True)
class Coverage:
    table: str
    session_type: Optional[str]
    job: str
    due_after: str
    present_sql: str

    @property
    def flag(self) -> str:
        return self.job

    @property
    def sprint_only(self) -> bool:
        return self.session_type in ("sprint", "SQ")


def _session_rows(table: str, session_type: str) -> str:
    return f"EXISTS (SELECT 1 FROM {table} t WHERE t.race_id = r.id AND t.session_type = '{session_type}')"


def _telemetry_complete(session_type: str, entrants_sql: str) -> str:
    return (f"(SELECT count(*) FROM qualifying_lap_telemetry t WHERE t.race_id = r.id AND t.session_type = "
            f"'{session_type}') >= ({entrants_sql})")


# Race Events whose emptiness means a gap; team radio is left out because F1 often publishes none.
_RACE_TABLES = (
    ("race_control_messages", "ingest_race_control"),
    ("race_overtakes", "ingest_overtakes"),
    ("race_stints", "ingest_stints"),
    ("race_pit_stops", "ingest_pit_stops"),
    ("race_lap_traces", "ingest_race_story"),
)

COVERAGES: tuple[Coverage, ...] = (
    Coverage("qualifying_lap_telemetry", "Q", "ingest_qualifying_telemetry", "ingest_qualifying",
             _telemetry_complete("Q", "SELECT count(*) FROM qualifying_results q WHERE q.race_id = r.id")),
    Coverage("qualifying_lap_telemetry", "SQ", "ingest_qualifying_telemetry_sprint", "ingest_sprint_qualifying",
             _telemetry_complete("SQ", "SELECT count(*) FROM sprint_results q "
                                       "WHERE q.race_id = r.id AND q.sq1_time_ms IS NOT NULL")),
    *(Coverage(table, session_type, step_name(job, session_type), "ingest_race", _session_rows(table, session_type))
      for session_type in SESSIONS for table, job in _RACE_TABLES),
    Coverage("team_season_stats", None, "compute_season_stats", "ingest_race",
             "COALESCE((SELECT max(t.races_completed) FROM team_season_stats t WHERE t.season_id = r.season_id), 0)"
             " >= (SELECT count(*) FROM races c WHERE c.season_id = r.season_id AND c.status = 'completed')"),
    Coverage("title_odds_drivers", None, "compute_title_odds", "ingest_race",
             "EXISTS (SELECT 1 FROM title_odds_drivers t "
             "WHERE t.season_id = r.season_id AND t.after_round = r.round_number)"),
)


def coverage_of(step: str) -> Coverage:
    return next(c for c in COVERAGES if c.job == step)


_COVERAGE_SQL = f"""
SELECT r.id, r.season_id, r.round_number, r.status, r.sprint_date, s.year, c.track_length_km,
  {", ".join(f"{cov.present_sql} AS {cov.flag}" for cov in COVERAGES)}
FROM races r
JOIN seasons s ON s.id = r.season_id
LEFT JOIN circuits c ON c.id = r.circuit_id
WHERE s.year BETWEEN %s AND %s AND (%s::int IS NULL OR r.round_number = %s)
ORDER BY s.year, r.round_number
"""


def read_coverage(conn: Any, year_from: int, year_to: int, round_number: Optional[int] = None) -> list[dict[str, Any]]:
    """One row per race in the seasons (or the one round), with a flag per Coverage."""
    with conn.cursor() as cur:
        cur.execute(_COVERAGE_SQL, (year_from, year_to, round_number, round_number))
        return cur.fetchall()


def backfill_allowed(conn: Any) -> bool:
    """The storage_guard check an enrichment backfill makes before each race it writes."""
    tier = read_storage_tier(conn)
    if not tier.allows_backfill:
        print(f"[STOP] Neon storage tier is {tier.value}: backfills are paused to protect the 1 GB Free limit")
    return tier.allows_backfill


def missing(row: dict[str, Any]) -> tuple[Coverage, ...]:
    """What a weekend's coverage row says it should have by now but doesn't. A flag absent from
    the row counts as present."""
    # Imported here: weekend_pipeline imports the jobs, which import this module.
    from src.weekend_pipeline import statuses_after

    sprint = row["sprint_date"] is not None
    return tuple(
        c for c in COVERAGES
        if (sprint or not c.sprint_only) and row["status"] in statuses_after(c.due_after)
        and not row.get(c.flag, True)
    )
