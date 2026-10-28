"""The FastF1 adapter, for the local 2018–2022 backfills and the pre-2018 legacy jobs (FastF1 only works
from an existing cache since ADR 0011). It hands back the same session_records the OpenF1 adapter does, so
both sources fill the tables through one mapping. Converters take plain records so they test without FastF1;
the session_* helpers do the DataFrame → records step."""
from datetime import datetime
from typing import Any, Optional

import fastf1
import pandas as pd

from src.enrichment_coverage import normalize_compound
from src.utils.race_story import WeatherTrace, weather_trace
from src.utils.session_records import CarSample, PitStop, PositionSample, RaceControlMessage, Stint
from src.utils.telemetry import LapWindow

Session = Any  # fastf1 has no type stubs


def get_session(year: int, round_num: int, session_type: str, messages: bool = False) -> Session:
    session = fastf1.get_session(year, round_num, session_type)
    telemetry = session_type in ("FP1", "FP2", "FP3")
    session.load(laps=True, telemetry=telemetry, weather=True, messages=messages)
    return session


def ms_to_int(val) -> int | None:
    """Convert a pandas timedelta-like value to integer milliseconds."""
    if pd.isna(val):
        return None
    try:
        td = pd.to_timedelta(val)
        return int(td.total_seconds() * 1000)
    except Exception:
        return None


def lap_records(session: Session) -> list[dict]:
    """Every lap with a position and end time: deliberately NOT pick_accurate(): the race story
    needs in/out laps too, or every pit stop would leave a hole in the gap chart."""
    records = []
    for _, lap in session.laps.iterrows():
        if pd.isna(lap.get("Position")) or pd.isna(lap.get("Time")) or pd.isna(lap.get("LapNumber")):
            continue
        records.append({
            "driver": str(lap["Driver"]).upper(),
            "lap": int(lap["LapNumber"]),
            "position": int(lap["Position"]),
            "time_ms": int(lap["Time"].total_seconds() * 1000),
        })
    return records


def session_weather_trace(session: Session) -> Optional[WeatherTrace]:
    """None when FastF1 has no weather samples for the session."""
    weather = getattr(session, "weather_data", None)
    if weather is None:
        return None
    weather = weather.dropna(subset=["Time", "AirTemp", "TrackTemp", "Rainfall"])
    if weather.empty:
        return None
    return weather_trace(weather)

# A lane visit longer than this is a red-flag wait in the pit lane, not a pit stop.
MAX_PIT_LANE_MS = 120_000


def _present(value: Any) -> bool:
    return value is not None and not (isinstance(value, float) and pd.isna(value)) and value is not pd.NaT


def _int_or_none(value: Any) -> Optional[int]:
    return int(value) if _present(value) else None


def _td_ms(value: Any) -> Optional[int]:
    return int(pd.to_timedelta(value).total_seconds() * 1000) if _present(value) else None


def _utc(value: Any) -> Optional[datetime]:
    if not _present(value):
        return None
    ts = pd.Timestamp(value)
    return (ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")).to_pydatetime()


def _number(lap: dict) -> Optional[int]:
    value = lap.get("DriverNumber")
    return int(value) if _present(value) and str(value).isdigit() else None


def stints(laps: list[dict]) -> list[Stint]:
    """One per (driver, stint): first/last lap, the stint's compound, tyre age when fitted.
    2018 timing leaves lap 1 without a stint or tyre age: laps before a driver's first numbered
    stint belong to it, and the age is worked back from the first lap that has one."""
    by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        by_driver.setdefault(lap["Driver"], []).append(lap)
    out = []
    for code, driver_laps in by_driver.items():
        ordered = sorted(driver_laps, key=lambda l: l["LapNumber"])
        first_stint = next((_int_or_none(l.get("Stint")) for l in ordered if _present(l.get("Stint"))), None)
        if first_stint is None:
            continue
        found: dict[int, dict] = {}
        for lap in ordered:
            stint = _int_or_none(lap.get("Stint"))
            if stint is None:
                if found:
                    continue
                stint = first_stint
            number = int(lap["LapNumber"])
            row = found.setdefault(stint, {"compound": None, "lap_start": number, "lap_end": number, "age": None})
            row["lap_end"] = number
            if row["compound"] is None:
                row["compound"] = normalize_compound(lap.get("Compound"))
            tyre_life = _int_or_none(lap.get("TyreLife"))
            if row["age"] is None and tyre_life is not None:
                # TyreLife counts the current lap, so a fresh set reads 1 on its first lap.
                row["age"] = max(tyre_life - 1 - (number - row["lap_start"]), 0)
        out.extend(
            Stint(driver_number=_number(ordered[0]), driver_code=code, stint_number=n, compound=r["compound"],
                  lap_start=r["lap_start"], lap_end=r["lap_end"], tyre_age_at_start=r["age"])
            for n, r in found.items()
        )
    return out


def pit_stops(laps: list[dict]) -> list[PitStop]:
    """A stop is an in-lap's PitInTime to the next lap's PitOutTime; FastF1 has no stationary time."""
    by_driver: dict[str, list[dict]] = {}
    for lap in laps:
        by_driver.setdefault(lap["Driver"], []).append(lap)
    out = []
    for code, driver_laps in by_driver.items():
        ordered = sorted(driver_laps, key=lambda l: l["LapNumber"])
        for lap, out_lap in zip(ordered, ordered[1:]):
            pit_in, pit_out = lap.get("PitInTime"), out_lap.get("PitOutTime")
            if not _present(pit_in) or not _present(pit_out):
                continue
            lane_ms = _td_ms(pd.to_timedelta(pit_out) - pd.to_timedelta(pit_in))
            if lane_ms is None or lane_ms <= 0 or lane_ms > MAX_PIT_LANE_MS:
                continue
            date = None
            if _present(lap.get("LapStartDate")) and _present(lap.get("LapStartTime")):
                date = _utc(pd.Timestamp(lap["LapStartDate"]) + (pd.to_timedelta(pit_in) - pd.to_timedelta(lap["LapStartTime"])))
            out.append(PitStop(driver_number=_number(lap), driver_code=code, lap_number=int(lap["LapNumber"]),
                               pit_lane_ms=lane_ms, stationary_ms=None, date=date))
    return out


def race_control_messages(messages: list[dict]) -> list[RaceControlMessage]:
    out = []
    for m in messages:
        date = _utc(m.get("Time"))
        if date is None or not _present(m.get("Message")):
            continue
        racing_number = m.get("RacingNumber")
        out.append(RaceControlMessage(
            date=date,
            category=m.get("Category") or "Other",
            flag=m.get("Flag") if _present(m.get("Flag")) else None,
            lap_number=_int_or_none(m.get("Lap")),
            driver_number=int(racing_number) if _present(racing_number) and str(racing_number).isdigit() else None,
            scope=m.get("Scope") if _present(m.get("Scope")) else None,
            sector=_int_or_none(m.get("Sector")),
            message=m["Message"],
        ))
    return out


def _at(value: Any) -> datetime:
    ts = pd.Timestamp(value)
    return (ts.tz_localize("UTC") if ts.tzinfo is None else ts).to_pydatetime()


def telemetry_inputs(
    car: list[dict], pos: list[dict], lap_number: int, lap_start: Any, lap_time: Any,
) -> tuple[list[CarSample], list[PositionSample], LapWindow]:
    """FastF1 car/position samples → the same samples the OpenF1 adapter returns."""
    car_data = [
        CarSample(at=_at(s["Date"]), speed=float(s["Speed"]), throttle=float(s["Throttle"]), brake=bool(s["Brake"]),
                  gear=int(s["nGear"]))
        for s in car
    ]
    location = [PositionSample(at=_at(p["Date"]), x=float(p["X"]), y=float(p["Y"])) for p in pos]
    start = pd.Timestamp(lap_start)
    window = LapWindow(
        lap_number=int(lap_number),
        start=(start.tz_localize("UTC") if start.tzinfo is None else start).to_pydatetime(),
        lap_ms=int(pd.to_timedelta(lap_time).total_seconds() * 1000),
    )
    return car_data, location, window


def lap_frame_records(session: Any) -> list[dict]:
    """session.laps as plain records, the input stints() and pit_stops() read."""
    return session.laps.to_dict("records")


def session_message_records(session: Any) -> list[dict]:
    return session.race_control_messages.to_dict("records")


def fastest_lap_inputs(session: Any) -> list[tuple[str, list[dict], list[dict], LapWindow]]:
    """Each driver's fastest timed qualifying lap as (code, car_data, location, window)."""
    out = []
    for code in session.laps["Driver"].dropna().unique():
        lap = session.laps.pick_drivers(code).pick_fastest()
        if lap is None or not _present(lap.get("LapTime")) or not _present(lap.get("LapStartDate")):
            continue
        try:
            car = lap.get_car_data().to_dict("records")
            pos = lap.get_pos_data().to_dict("records")
        except Exception as e:
            print(f"  [SKIP] {code}: no telemetry ({e})")
            continue
        if len(car) < 2 or len(pos) < 2:
            continue
        out.append((code, *telemetry_inputs(car, pos, lap["LapNumber"], lap["LapStartDate"], lap["LapTime"])))
    return out

