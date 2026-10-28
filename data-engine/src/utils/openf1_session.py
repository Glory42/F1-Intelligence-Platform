"""The OpenF1 + Jolpica adapter: the only module that knows OpenF1's endpoints and field names (Jolpica's
classification fields included). It finds a weekend's session, loads it, and hands the jobs typed records
(session_records) or the row shapes the result tables take. Live ingest moved here from FastF1 when F1 put
its timing feed behind F1TV logins (FastF1 3.9, Oct 2026, ADR 0011)."""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

import pandas as pd

from src.enrichment_coverage import normalize_compound
from src.utils import openf1_client
from src.utils.driver_registry import SessionEntry, team_key_for
from src.utils.race_story import WeatherTrace, weather_trace
from src.utils.session_records import (
    CarSample, Overtake, PitStop, PositionSample, RaceControlMessage, RadioClip, Stint,
)
from src.utils.telemetry import LapWindow

# Keyed by the FastF1 session identifiers the job configs already use.
SESSION_NAMES: dict[str, tuple[str, ...]] = {
    "R": ("Race",),
    "S": ("Sprint",),
    "Q": ("Qualifying",),
    # 2023 called it the Sprint Shootout, 2024 on Sprint Qualifying; OpenF1 keeps each year's name.
    "SQ": ("Sprint Qualifying", "Sprint Shootout"),
    "SS": ("Sprint Shootout", "Sprint Qualifying"),
    "FP1": ("Practice 1",),
    "FP2": ("Practice 2",),
}

_ENDPOINTS = {
    "drivers": "drivers", "results": "session_result", "laps": "laps", "stints": "stints",
    "pits": "pit", "weather": "weather", "race_control": "race_control", "overtakes": "overtakes",
    "team_radio": "team_radio",
}
RACE_PARTS = ("drivers", "laps", "stints", "pits", "weather", "race_control")
QUALIFYING_PARTS = ("drivers", "results", "laps")
STORY_PARTS = ("drivers", "laps", "weather")
PRACTICE_PARTS = ("laps", "stints")

_MIN_CLASSIFIED = 10
_MIN_LAPS = {"R": 100, "S": 50}
_SECTOR_SUM_TOLERANCE_MS = 3


@dataclass(frozen=True)
class OpenF1Session:
    session_key: int
    drivers: list[dict] = field(default_factory=list)
    results: list[dict] = field(default_factory=list)
    laps: list[dict] = field(default_factory=list)
    stints: list[dict] = field(default_factory=list)
    pits: list[dict] = field(default_factory=list)
    weather: list[dict] = field(default_factory=list)
    race_control: list[dict] = field(default_factory=list)
    overtakes: list[dict] = field(default_factory=list)
    team_radio: list[dict] = field(default_factory=list)


def find_session(year: int, race_date: Any, session_type: str) -> int:
    """The weekend is found by its Race's date, then the session by name within that meeting
    (cancelled sessions skipped): one way for every job, whichever session it reads."""
    return openf1_client.find_weekend_session_key(year, race_date, SESSION_NAMES[session_type])


def load_session(
    year: int, race_date: Any, session_type: str, parts: tuple[str, ...], session_key: Optional[int] = None,
) -> OpenF1Session:
    """One request to find the session (none when `session_key` is cached), then one per part, all through
    the paced OpenF1 client."""
    key = session_key or find_session(year, race_date, session_type)
    return OpenF1Session(
        session_key=key,
        **{part: openf1_client.fetch_session_data(_ENDPOINTS[part], key) for part in parts},
    )


def _present(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def _driver_code(abbreviation: Any, first_name: str, last_name: str, driver_number: int) -> str:
    if _present(abbreviation):
        return str(abbreviation).upper()[:3]
    source = last_name or first_name
    code = "".join(c for c in source if c.isalpha())[:3].upper()
    if len(code) < 3:
        code = (code + str(driver_number))[:3].upper()
    return code


def session_entries(session: OpenF1Session) -> list[SessionEntry]:
    """Who the session lists, from its drivers part."""
    entries = []
    for info in session.drivers:
        try:
            driver_number = int(info.get("driver_number") or 0)
        except (ValueError, TypeError):
            driver_number = 0
        first_name = str(info.get("first_name") or "").strip()
        last_name = str(info.get("last_name") or "").strip()
        if not first_name and not last_name:
            first_name, _, last_name = str(info.get("full_name") or f"Driver {driver_number}").partition(" ")
        team_name = str(info.get("team_name") or "Unknown")
        country = info.get("country_code")
        entries.append(SessionEntry(
            driver_number=driver_number,
            code=_driver_code(info.get("name_acronym"), first_name, last_name, driver_number),
            first_name=first_name,
            last_name=last_name,
            team_key=team_key_for(team_name),
            team_name=team_name,
            nationality=str(country) if _present(country) else None,
        ))
    return entries


def _ms(seconds: Any) -> int | None:
    return None if seconds is None else round(float(seconds) * 1000)


def _at(timestamp: str | None) -> datetime | None:
    return datetime.fromisoformat(timestamp) if timestamp else None


def _window(lap: dict) -> tuple[datetime, datetime] | None:
    start = _at(lap.get("date_start"))
    if start is None or lap.get("lap_duration") is None:
        return None
    return start, start + timedelta(seconds=lap["lap_duration"])


def driver_codes(session: OpenF1Session) -> dict[int, str]:
    return {entry.driver_number: entry.code for entry in session_entries(session)}


@dataclass(frozen=True)
class Neutralisation:
    kind: str  # "SC", "VSC" or "RED"
    start: datetime
    end: datetime | None  # None: still running when the feed ends

    def overlaps(self, window: tuple[datetime, datetime]) -> bool:
        return self.start < window[1] and (self.end is None or window[0] < self.end)

    def covers(self, window: tuple[datetime, datetime]) -> bool:
        return self.start <= window[0] and (self.end is None or window[1] <= self.end)


def _deployed(message: dict) -> str | None:
    text = (message.get("message") or "").upper()
    if message.get("flag") == "RED":
        return "RED"
    if "DEPLOYED" not in text:
        return None
    if "VSC" in text or "VIRTUAL" in text:
        return "VSC"
    return "SC" if "SAFETY CAR" in text else None


def neutralisations(race_control: list[dict]) -> list[Neutralisation]:
    """Each Safety Car, VSC or red flag runs from its deployment to the next track-wide green or
    clear; a VSC that turns into a Safety Car becomes two back-to-back periods."""
    periods: list[Neutralisation] = []
    open_kind: str | None = None
    open_start: datetime | None = None
    for message in sorted(race_control, key=lambda m: m["date"]):
        at = _at(message["date"])
        kind = _deployed(message)
        if kind is not None:
            if open_kind is not None:
                periods.append(Neutralisation(open_kind, open_start, at))
            open_kind, open_start = kind, at
        elif open_kind is not None and message.get("scope") == "Track" and message.get("flag") in ("CLEAR", "GREEN"):
            periods.append(Neutralisation(open_kind, open_start, at))
            open_kind = None
    if open_kind is not None:
        periods.append(Neutralisation(open_kind, open_start, None))
    return periods


def safety_car_laps(session: OpenF1Session) -> dict[str, int]:
    """Distinct lap numbers any car was on while a Safety Car or VSC ran, as FastF1 counted them."""
    periods = neutralisations(session.race_control)
    laps: dict[str, set[int]] = {"SC": set(), "VSC": set()}
    for lap in session.laps:
        window = _window(lap)
        if window is None:
            continue
        for period in periods:
            if period.kind in laps and period.overlaps(window):
                laps[period.kind].add(lap["lap_number"])
    return {"safety_car_laps": len(laps["SC"]), "vsc_laps": len(laps["VSC"])}


def stints_by_driver(stints: list[dict]) -> dict[int, list[dict]]:
    by_driver: dict[int, list[dict]] = defaultdict(list)
    for stint in stints:
        by_driver[stint["driver_number"]].append(stint)
    return by_driver


def stint_for(stints: list[dict], lap_number: int) -> dict | None:
    for stint in stints:
        if stint.get("lap_start") is not None and stint["lap_start"] <= lap_number <= (stint.get("lap_end") or lap_number):
            return stint
    return None


def _is_accurate(lap: dict, previous: dict | None, periods: list[Neutralisation], in_laps: set[tuple[int, int]]) -> bool:
    """FastF1's pick_accurate(): a green-flag racing lap whose sectors add up to its lap time,
    not straight after a lap spent wholly behind the Safety Car. Lap 1 is never accurate."""
    if lap["lap_number"] <= 1 or lap.get("is_pit_out_lap") or (lap["driver_number"], lap["lap_number"]) in in_laps:
        return False
    sectors = [_ms(lap.get(f"duration_sector_{i}")) for i in (1, 2, 3)]
    lap_ms = _ms(lap.get("lap_duration"))
    if lap_ms is None or None in sectors or abs(sum(sectors) - lap_ms) > _SECTOR_SUM_TOLERANCE_MS:
        return False
    window = _window(lap)
    if window is None or any(p.overlaps(window) for p in periods):
        return False
    previous_window = _window(previous) if previous else None
    return previous_window is None or not any(p.kind == "SC" and p.covers(previous_window) for p in periods)


def lap_times(session: OpenF1Session) -> list[dict[str, Any]]:
    codes = driver_codes(session)
    periods = neutralisations(session.race_control)
    in_laps = {(p["driver_number"], p["lap_number"]) for p in session.pits if p.get("lap_number") is not None}
    stints = stints_by_driver(session.stints)
    by_key = {(lap["driver_number"], lap["lap_number"]): lap for lap in session.laps}

    rows = []
    for (number, lap_number), lap in sorted(by_key.items()):
        code = codes.get(number)
        if code is None or not _is_accurate(lap, by_key.get((number, lap_number - 1)), periods, in_laps):
            continue
        stint = stint_for(stints.get(number, []), lap_number)
        age_at_start = stint.get("tyre_age_at_start") if stint else None
        rows.append({
            "driver_code": code,
            "lap_number": lap_number,
            "lap_time_ms": _ms(lap["lap_duration"]),
            "sector1_ms": _ms(lap["duration_sector_1"]),
            "sector2_ms": _ms(lap["duration_sector_2"]),
            "sector3_ms": _ms(lap["duration_sector_3"]),
            "speed_st": float(lap["st_speed"]) if lap.get("st_speed") is not None else None,
            "compound": stint["compound"].upper() if stint and stint.get("compound") else None,
            "tyre_life": age_at_start + lap_number - stint["lap_start"] + 1 if age_at_start is not None else None,
            "fresh_tyre": age_at_start == 0 if age_at_start is not None else None,
            "is_pit_lap": False,  # in-laps never pass the accuracy check
            "stint_number": stint["stint_number"] if stint else None,
        })
    return rows


def lap_records(session: OpenF1Session) -> list[dict[str, Any]]:
    """Every completed lap, in/out laps included, ranked by when each car crossed the line: the
    running order at the end of that lap. time_ms counts from the first lap's start."""
    codes = driver_codes(session)
    crossings: dict[int, list[tuple[datetime, str]]] = defaultdict(list)
    starts = []
    for lap in session.laps:
        window = _window(lap)
        code = codes.get(lap["driver_number"])
        if window is None or code is None:
            continue
        starts.append(window[0])
        crossings[lap["lap_number"]].append((window[1], code))
    if not starts:
        return []
    origin = min(starts)
    return [
        {"driver": code, "lap": lap_number, "position": position,
         "time_ms": round((end - origin).total_seconds() * 1000)}
        for lap_number, ends in crossings.items()
        for position, (end, code) in enumerate(sorted(ends), start=1)
    ]


def _fastest_lap_driver(laps: list[dict]) -> int | None:
    timed = [lap for lap in laps if (lap.get("lap_duration") or 0) > 0]
    return min(timed, key=lambda lap: lap["lap_duration"])["driver_number"] if timed else None


def _millis(entry: dict) -> int | None:
    timing = entry.get("Time") or {}
    return int(timing["millis"]) if timing.get("millis") and timing.get("time") else None


def race_results(session: OpenF1Session, classification: list[dict]) -> list[dict[str, Any]]:
    """classification: Jolpica Results rows. Times follow FastF1: the winner's race time, then each
    lead-lap finisher's gap to the winner; lapped and retired cars have none."""
    codes = driver_codes(session)
    headshots = {d["driver_number"]: d.get("headshot_url") for d in session.drivers}
    fastest = _fastest_lap_driver(session.laps)
    winner_ms = next((_millis(e) for e in classification if e.get("position") == "1"), None)

    rows = []
    for entry in classification:
        number = int(entry["number"])
        millis = _millis(entry)
        position = int(entry["position"]) if entry.get("position") else None
        headshot = headshots.get(number)
        rows.append({
            "driver_code": codes.get(number) or str(entry["Driver"].get("code") or "").upper(),
            "finish_position": position,
            "grid_position": int(entry["grid"]) if entry.get("grid") not in (None, "") else 20,
            "points": float(entry.get("points") or 0),
            "status": entry.get("status") or "Unknown",
            "total_race_time_ms": millis if position == 1 or millis is None or winner_ms is None else millis - winner_ms,
            "fastest_lap": number == fastest,
            "headshot_url": headshot if headshot and str(headshot).startswith("http") else None,
        })
    return rows


def is_complete(session: OpenF1Session, classification: list[dict], session_type: str) -> bool:
    """Guards against ingesting a session OpenF1 or Jolpica has only partly published."""
    classified = [e for e in classification if e.get("position") and int(e["position"]) > 0]
    if len(classified) < _MIN_CLASSIFIED:
        print(f"[is_complete] Only {len(classified)} classified finishers so far.")
        return False
    winner = next((e for e in classified if e["position"] == "1"), None)
    if winner is None or _millis(winner) is None:
        print("[is_complete] The winner has no race time yet.")
        return False
    if len(session.laps) < _MIN_LAPS[session_type]:
        print(f"[is_complete] Only {len(session.laps)} laps published, below {_MIN_LAPS[session_type]}.")
        return False
    return True


def qualifying_results(session: OpenF1Session) -> list[dict[str, Any]]:
    """Grid = qualifying classification; Q1-Q3 from session_result, best sectors and speed trap
    from any of the driver's laps."""
    codes = driver_codes(session)
    best: dict[int, dict[str, Any]] = defaultdict(dict)
    for lap in session.laps:
        driver = best[lap["driver_number"]]
        for i in (1, 2, 3):
            value = _ms(lap.get(f"duration_sector_{i}"))
            if value is not None and value < driver.get(f"sector{i}_ms", value + 1):
                driver[f"sector{i}_ms"] = value
        if lap.get("st_speed") is not None:
            driver["speed_st"] = max(float(lap["st_speed"]), driver.get("speed_st", 0.0))

    rows = []
    for result in sorted(session.results, key=lambda r: r.get("position") or 99):
        code = codes.get(result["driver_number"])
        if result.get("position") is None or code is None:
            continue
        times = result.get("duration")
        times = list(times) if isinstance(times, list) else [times]
        q1, q2, q3 = (times + [None, None, None])[:3]
        sectors = best.get(result["driver_number"], {})
        rows.append({
            "driver_code": code,
            "grid_position": int(result["position"]),
            "q1_time_ms": _ms(q1),
            "q2_time_ms": _ms(q2),
            "q3_time_ms": _ms(q3),
            "sector1_ms": sectors.get("sector1_ms"),
            "sector2_ms": sectors.get("sector2_ms"),
            "sector3_ms": sectors.get("sector3_ms"),
            "speed_st": sectors.get("speed_st"),
        })
    return rows


def _weather_frame(session: OpenF1Session) -> pd.DataFrame:
    rows = [
        {"Time": pd.Timestamp(w["date"]), "AirTemp": w.get("air_temperature"), "TrackTemp": w.get("track_temperature"),
         "Rainfall": w.get("rainfall"), "Humidity": w.get("humidity")}
        for w in sorted(session.weather, key=lambda w: w["date"])
    ]
    return pd.DataFrame(rows, columns=["Time", "AirTemp", "TrackTemp", "Rainfall", "Humidity"])


def weather_label(session: OpenF1Session) -> str:
    rain = _weather_frame(session)["Rainfall"].dropna()
    if rain.empty:
        return "dry"
    share = float(rain.astype(float).mean())
    return "wet" if share > 0.5 else "mixed" if share > 0.1 else "dry"


def weather_details(session: OpenF1Session) -> dict[str, float | None]:
    frame = _weather_frame(session)

    def _mean(column: str) -> float | None:
        values = frame[column].dropna()
        return round(float(values.astype(float).mean()), 1) if not values.empty else None

    return {"air_temp_avg": _mean("AirTemp"), "track_temp_avg": _mean("TrackTemp"), "humidity_avg": _mean("Humidity")}


def session_weather_trace(session: OpenF1Session) -> WeatherTrace | None:
    frame = _weather_frame(session).dropna(subset=["Time", "AirTemp", "TrackTemp", "Rainfall"])
    return weather_trace(frame) if not frame.empty else None


def stints(session: OpenF1Session) -> list[Stint]:
    return [
        Stint(driver_number=s["driver_number"], driver_code=None, stint_number=s["stint_number"],
              compound=normalize_compound(s.get("compound")), lap_start=s["lap_start"], lap_end=s["lap_end"],
              tyre_age_at_start=s.get("tyre_age_at_start"))
        for s in session.stints
    ]


def pit_stops(session: OpenF1Session) -> list[PitStop]:
    return [
        PitStop(driver_number=p["driver_number"], driver_code=None, lap_number=p["lap_number"],
                pit_lane_ms=_ms(p.get("pit_duration")), stationary_ms=_ms(p.get("stop_duration")),
                date=p["date"])
        for p in session.pits
    ]


def race_control_messages(session: OpenF1Session) -> list[RaceControlMessage]:
    return [
        RaceControlMessage(date=m["date"], category=m["category"], flag=m.get("flag"), lap_number=m.get("lap_number"),
                           driver_number=m.get("driver_number"), scope=m.get("scope"), sector=m.get("sector"),
                           message=m["message"])
        for m in session.race_control
    ]


def overtakes(session: OpenF1Session) -> list[Overtake]:
    return [
        Overtake(date=o["date"], overtaking_number=o["overtaking_driver_number"],
                 overtaken_number=o["overtaken_driver_number"], position=o["position"])
        for o in session.overtakes
    ]


def radio_clips(session: OpenF1Session) -> list[RadioClip]:
    return [RadioClip(driver_number=c["driver_number"], date=c["date"], recording_url=c["recording_url"])
            for c in session.team_radio]


@dataclass(frozen=True)
class PracticeLap:
    driver_number: int
    lap_number: int
    lap_ms: Optional[int]
    is_pit_out_lap: bool
    compound: str  # upper-case, "" when the stint is unknown


def practice_laps(session: OpenF1Session) -> list[PracticeLap]:
    """Every practice lap with the compound of the stint it was run on."""
    by_driver = stints_by_driver(session.stints)
    out = []
    for lap in session.laps:
        stint = stint_for(by_driver.get(lap["driver_number"], []), lap["lap_number"])
        duration = lap.get("lap_duration")
        out.append(PracticeLap(
            driver_number=lap["driver_number"],
            lap_number=lap["lap_number"],
            lap_ms=round(duration * 1000) if duration and duration > 0 else None,
            is_pit_out_lap=bool(lap.get("is_pit_out_lap")),
            compound=(stint.get("compound") or "").upper() if stint else "",
        ))
    return out


def fastest_laps(session: OpenF1Session) -> dict[int, LapWindow]:
    """Each car number's quickest timed lap; out-laps and untimed laps are skipped."""
    best: dict[int, LapWindow] = {}
    for lap in session.laps:
        # OpenF1 occasionally sends a timed lap without its start date; it can't be windowed.
        if not lap.get("lap_duration") or lap.get("is_pit_out_lap") or not lap.get("date_start"):
            continue
        window = LapWindow(
            lap_number=lap["lap_number"],
            start=datetime.fromisoformat(lap["date_start"]),
            lap_ms=round(lap["lap_duration"] * 1000),
        )
        current = best.get(lap["driver_number"])
        if current is None or window.lap_ms < current.lap_ms:
            best[lap["driver_number"]] = window
    return best


def lap_samples(session_key: int, driver_number: int, window: LapWindow) -> tuple[list[CarSample], list[PositionSample]]:
    """The car and position samples over one lap: two paced requests."""
    end = window.start + timedelta(milliseconds=window.lap_ms)
    car = openf1_client.fetch_lap_samples("car_data", session_key, driver_number, window.start, end)
    location = openf1_client.fetch_lap_samples("location", session_key, driver_number, window.start, end)
    return (
        [CarSample(at=datetime.fromisoformat(c["date"]), speed=float(c["speed"]), throttle=float(c["throttle"]),
                   brake=bool(c["brake"]), gear=int(c["n_gear"])) for c in car],
        [PositionSample(at=datetime.fromisoformat(p["date"]), x=float(p["x"]), y=float(p["y"])) for p in location],
    )
