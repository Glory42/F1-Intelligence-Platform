"""What a weekend's format, its race sessions and a season's year mean to the data engine, in one place.
Mirrors apps/api/src/common/session-kind.ts. Imported by jobs and by weekend_pipeline alike, so it
imports neither."""
from dataclasses import dataclass
from datetime import timedelta
from enum import Enum
from typing import Optional

# event_format values whose weekend runs Sprint Qualifying and a sprint ("sprint_shootout" is 2023's name).
SPRINT_FORMATS = frozenset({"sprint", "sprint_qualifying", "sprint_shootout"})


def is_sprint_weekend(event_format: Optional[str]) -> bool:
    return event_format in SPRINT_FORMATS


@dataclass(frozen=True)
class RaceSession:
    """A session that runs a race: the GP or the sprint."""

    code: str  # the adapters' session id ("R", "S"), as FastF1 named them
    name: str  # the CLI's --session and OpenF1's session_name
    tag: str  # session_type in the Race Event, strategy and race-story tables
    key_column: str  # races column caching the session's OpenF1 session_key


RACE = RaceSession("R", "Race", "race", "openf1_race_session_key")
SPRINT = RaceSession("S", "Sprint", "sprint", "openf1_sprint_session_key")
RACE_SESSIONS = (RACE, SPRINT)
BY_NAME = {s.name: s for s in RACE_SESSIONS}
BY_CODE = {s.code: s for s in RACE_SESSIONS}

# OpenF1's free tier serves a session ~30 min after it ends; we only store start times, so these pad from
# the start by a typical session length plus margin, erring towards waiting a cycle longer.
OPENF1_READY_AFTER_RACE_START = timedelta(hours=3)
OPENF1_READY_AFTER_QUALIFYING_START = timedelta(hours=2)


class Source(Enum):
    FASTF1 = "fastf1"
    OPENF1 = "openf1"


FASTF1_FIRST_YEAR = 2018
OPENF1_FIRST_YEAR = 2023


def source_for(year: int) -> Optional[Source]:
    """Who serves a season's lap timing: OpenF1 from 2023, FastF1's local cache for 2018–2022 (its live
    feed needs F1TV since ADR 0011), nobody before 2018."""
    if year >= OPENF1_FIRST_YEAR:
        return Source.OPENF1
    if year >= FASTF1_FIRST_YEAR:
        return Source.FASTF1
    return None


class ResultsIngest(Enum):
    LEGACY = "legacy"  # the *_legacy jobs: Ergast results through FastF1, no laps
    LIVE = "live"  # the OpenF1 + Jolpica jobs


def results_ingest_for(year: int) -> Optional[ResultsIngest]:
    """Which jobs can (re)build a season's results and laps. None for 2018–2022: their FastF1 timing is
    gone, so a backfill must leave those stored rows alone (ADR 0011)."""
    source = source_for(year)
    if source is Source.OPENF1:
        return ResultsIngest.LIVE
    return ResultsIngest.LEGACY if source is None else None
