"""FastF1 session readers for the local pre-2023 backfills; live ingest reads OpenF1 (openf1_session)."""
import fastf1
import pandas as pd
from typing import Any

Session = Any  # fastf1 has no type stubs; Session is Session at runtime


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


def session_to_lap_records(session) -> list[dict]:
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


def session_weather_trace(session):
    """None when FastF1 has no weather samples for the session."""
    from src.utils.race_story import weather_trace

    weather = getattr(session, "weather_data", None)
    if weather is None:
        return None
    weather = weather.dropna(subset=["Time", "AirTemp", "TrackTemp", "Rainfall"])
    if weather.empty:
        return None
    return weather_trace(weather)
