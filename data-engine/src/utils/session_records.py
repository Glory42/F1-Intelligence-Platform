"""What a session source hands the ingest jobs: typed records, whichever adapter read them (openf1_session for
2023+, fastf1_session for the local 2018–2022 backfills), and the one mapping from each record to its table row.
A source swap rewrites an adapter; the rows, and so the tables, stay the same."""
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Optional, Sequence, TypeVar

from src.utils.driver_registry import SeasonDrivers


@dataclass(frozen=True)
class Stint:
    driver_number: Optional[int]
    driver_code: Optional[str]
    stint_number: int
    compound: Optional[str]  # normalized: SOFT, MEDIUM, HARD, INTERMEDIATE, WET or a 2018 named compound
    lap_start: int
    lap_end: int
    tyre_age_at_start: Optional[int]


@dataclass(frozen=True)
class PitStop:
    driver_number: Optional[int]
    driver_code: Optional[str]
    lap_number: int
    pit_lane_ms: Optional[int]
    stationary_ms: Optional[int]  # FastF1 has no stationary time
    date: Any  # ISO string (OpenF1) or datetime (FastF1)


@dataclass(frozen=True)
class RaceControlMessage:
    date: Any
    category: str
    flag: Optional[str]
    lap_number: Optional[int]
    driver_number: Optional[int]
    scope: Optional[str]
    sector: Optional[int]
    message: str


@dataclass(frozen=True)
class Overtake:
    date: Any
    overtaking_number: int
    overtaken_number: int
    position: int


@dataclass(frozen=True)
class RadioClip:
    driver_number: int
    date: Any
    recording_url: str


@dataclass(frozen=True)
class CarSample:
    at: datetime
    speed: float
    throttle: float
    brake: bool
    gear: int


@dataclass(frozen=True)
class PositionSample:
    at: datetime
    x: float
    y: float


Rows = tuple[list[dict[str, Any]], int]  # (rows to upsert, records skipped for an unknown driver)
R = TypeVar("R")


def _rows(records: Sequence[R], driver_id: Callable[[R], Optional[int]], shape: Callable[[R, int], dict]) -> Rows:
    rows, skipped = [], 0
    for record in records:
        found = driver_id(record)
        if found is None:
            skipped += 1
            continue
        rows.append(shape(record, found))
    return rows, skipped


def stint_rows(stints: Sequence[Stint], drivers: SeasonDrivers, race_id: int, session_type: str) -> Rows:
    return _rows(stints, lambda s: drivers.id_for(s.driver_number, s.driver_code), lambda s, d: {
        "race_id": race_id, "session_type": session_type, "driver_id": d, "stint_number": s.stint_number,
        "compound": s.compound, "lap_start": s.lap_start, "lap_end": s.lap_end,
        "tyre_age_at_start": s.tyre_age_at_start,
    })


def pit_stop_rows(stops: Sequence[PitStop], drivers: SeasonDrivers, race_id: int, session_type: str) -> Rows:
    return _rows(stops, lambda p: drivers.id_for(p.driver_number, p.driver_code), lambda p, d: {
        "race_id": race_id, "session_type": session_type, "driver_id": d, "lap_number": p.lap_number,
        "pit_lane_ms": p.pit_lane_ms, "stationary_ms": p.stationary_ms, "date": p.date,
    })


def race_control_rows(
    messages: Sequence[RaceControlMessage], drivers: SeasonDrivers, race_id: int, session_type: str,
) -> Rows:
    rows = [
        {"race_id": race_id, "session_type": session_type, "date": m.date, "category": m.category, "flag": m.flag,
         "lap_number": m.lap_number, "driver_number": m.driver_number, "scope": m.scope, "sector": m.sector,
         "message": m.message}
        for m in messages
    ]
    # The table is unique on (race, session, date, message): sources occasionally repeat a message.
    return list({(r["date"], r["message"]): r for r in rows}.values()), 0


def overtake_rows(overtakes: Sequence[Overtake], drivers: SeasonDrivers, race_id: int, session_type: str) -> Rows:
    def both(o: Overtake) -> Optional[tuple[int, int]]:
        a, b = drivers.id_for(o.overtaking_number), drivers.id_for(o.overtaken_number)
        return None if a is None or b is None else (a, b)

    rows, skipped = [], 0
    for o in overtakes:
        ids = both(o)
        if ids is None:
            skipped += 1
            continue
        rows.append({"race_id": race_id, "session_type": session_type, "date": o.date,
                     "overtaking_driver_id": ids[0], "overtaken_driver_id": ids[1], "position": o.position})
    return rows, skipped


def radio_rows(clips: Sequence[RadioClip], drivers: SeasonDrivers, race_id: int, session_type: str) -> Rows:
    return _rows(clips, lambda c: drivers.id_for(c.driver_number), lambda c, d: {
        "race_id": race_id, "session_type": session_type, "driver_id": d, "date": c.date,
        "recording_url": c.recording_url,
    })
